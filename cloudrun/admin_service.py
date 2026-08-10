from __future__ import annotations

import hmac
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import google.auth
import requests
from flask import Flask, jsonify, request
from google.auth.transport.requests import Request as GoogleAuthRequest

from radar_processing.control import parse_focus_polling_state
from radar_processing.config import RegionBounds, mrms_product_tier
from radar_processing.era5 import (
    ERA5_PROCESSING_BOUNDS,
    ERA5_MAX_FRAMES,
    ERA5_MAX_HOURS,
    validate_era5_bounds,
    validate_era5_request,
)
from radar_processing.history import parse_timestamp
from radar_processing.r2 import (
    R2PublishConfig,
    create_r2_client,
    get_json_object,
    get_json_object_with_etag,
    is_precondition_failed,
    put_json_object,
)


app = Flask(__name__)
JOB_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,62}$")
REGION_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
MRMS_CONUS_BOUNDS = (-130.0, 20.0, -60.0, 55.0)


def _authorized() -> bool:
    expected = os.getenv("ADMIN_SERVICE_TOKEN", "").strip()
    received = request.headers.get("Authorization", "")
    return bool(expected) and hmac.compare_digest(received, f"Bearer {expected}")


def _require_auth():
    if not _authorized():
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _google_post(url: str, payload: dict | None = None) -> dict:
    credentials, _ = google.auth.default(scopes=[GOOGLE_SCOPE])
    credentials.refresh(GoogleAuthRequest())
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {credentials.token}", "Content-Type": "application/json"},
        json=payload or {},
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Google API returned HTTP {response.status_code}: {response.text[:500]}")
    return response.json() if response.content else {}


def _google_get(url: str) -> dict:
    credentials, _ = google.auth.default(scopes=[GOOGLE_SCOPE])
    credentials.refresh(GoogleAuthRequest())
    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {credentials.token}"},
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Google API returned HTTP {response.status_code}: {response.text[:500]}")
    return response.json() if response.content else {}


def _project() -> str:
    value = os.getenv("GCP_PROJECT_ID", "").strip()
    if not value:
        raise RuntimeError("GCP_PROJECT_ID is not configured")
    return value


def _region() -> str:
    return os.getenv("GCP_REGION", "us-east1").strip()


def _scheduler_resource_url() -> str:
    job = os.getenv("LIVE_SCHEDULER_JOB", "wallcloud-live-refresh").strip()
    return f"https://cloudscheduler.googleapis.com/v1/projects/{_project()}/locations/{_region()}/jobs/{job}"


def _focus_scheduler_resource_url() -> str:
    job = os.getenv("FOCUS_SCHEDULER_JOB", "wallcloud-focus-refresh").strip()
    return f"https://cloudscheduler.googleapis.com/v1/projects/{_project()}/locations/{_region()}/jobs/{job}"


def _set_scheduler_enabled(resource_url: str, *, enabled: bool) -> None:
    state = _google_get(resource_url).get("state")
    if state not in {"ENABLED", "PAUSED"}:
        raise RuntimeError(f"Cloud Scheduler returned an unexpected state: {state or 'missing'}")
    if enabled and state == "PAUSED":
        _google_post(f"{resource_url}:resume")
    elif not enabled and state == "ENABLED":
        _google_post(f"{resource_url}:pause")


def _set_live_scheduler_enabled(enabled: bool) -> None:
    _set_scheduler_enabled(_scheduler_resource_url(), enabled=enabled)


def _set_focus_scheduler_enabled(enabled: bool) -> None:
    _set_scheduler_enabled(_focus_scheduler_resource_url(), enabled=enabled)


def _run_job_url(job_name: str) -> str:
    encoded = quote(job_name, safe="")
    return f"https://run.googleapis.com/v2/projects/{_project()}/locations/{_region()}/jobs/{encoded}:run"


def _r2_client():
    config = R2PublishConfig.from_env()
    return create_r2_client(config), config


def _history_prefix(source: str) -> str:
    if source == "era5":
        return "radar/history/era5"
    return "radar/history" if source == "mrms" else "radar/krax/history"


def _bounds_match(first: Any, second: list[float]) -> bool:
    if not isinstance(first, list) or len(first) != 4:
        return False
    try:
        return all(abs(float(value) - second[index]) < 0.001 for index, value in enumerate(first))
    except (TypeError, ValueError):
        return False


def _history_entry_matches_scope(
    entry: dict[str, Any],
    source: str,
    region_id: str,
    bounds: list[float] | None,
) -> bool:
    if source == "krax":
        return True
    entry_bounds = entry.get("bounds")
    if region_id in {"view", "current-view"}:
        return bool(bounds and _bounds_match(entry_bounds, bounds))
    entry_region = str(entry.get("region_id", "")).strip().lower()
    region_matches = entry_region == region_id if entry_region else f"-{region_id}-" in str(entry.get("id", ""))
    if not region_matches:
        return False
    return not bounds or not isinstance(entry_bounds, list) or _bounds_match(entry_bounds, bounds)


def _covering_history_entry(
    client: Any,
    config: R2PublishConfig,
    source: str,
    start: datetime,
    end: datetime,
    region_id: str,
    bounds: list[float] | None,
) -> dict[str, Any] | None:
    catalog = get_json_object(client, config, f"{_history_prefix(source)}/catalog.json")
    datasets = catalog.get("datasets", []) if isinstance(catalog, dict) else []
    if not isinstance(datasets, list):
        return None
    for entry in datasets:
        if not isinstance(entry, dict) or not _history_entry_matches_scope(entry, source, region_id, bounds):
            continue
        try:
            entry_start = parse_timestamp(str(entry["start_time"]))
            entry_end = parse_timestamp(str(entry["end_time"]))
        except (KeyError, TypeError, ValueError):
            continue
        if start >= entry_start and end <= entry_end:
            return entry
    return None


def _parse_history_bounds(
    payload: dict,
    *,
    domain: list[float],
    outside_domain_message: str,
) -> tuple[list[float], str]:
    raw = payload.get("bounds", domain)
    if not isinstance(raw, list) or len(raw) != 4:
        raise ValueError("bounds must be [west, south, east, north]")
    try:
        west, south, east, north = (float(value) for value in raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("bounds values must be numeric") from exc
    conus_west, conus_south, conus_east, conus_north = domain
    if west >= east or south >= north:
        raise ValueError("bounds have an invalid geographic order")
    if west < conus_west or east > conus_east or south < conus_south or north > conus_north:
        raise ValueError(outside_domain_message)
    region_id = re.sub(r"[^a-z0-9]+", "-", str(payload.get("region_id", "view")).lower()).strip("-") or "view"
    if not REGION_ID_PATTERN.fullmatch(region_id):
        raise ValueError("region_id is invalid")
    return [west, south, east, north], region_id


def _mrms_bounds(payload: dict) -> tuple[list[float], str]:
    return _parse_history_bounds(
        payload,
        domain=list(MRMS_CONUS_BOUNDS),
        outside_domain_message="MRMS historical bounds must remain inside the CONUS processing domain",
    )


def _era5_bounds(payload: dict) -> tuple[list[float], str]:
    values, region_id = _parse_history_bounds(
        payload,
        domain=ERA5_PROCESSING_BOUNDS.as_list(),
        outside_domain_message="ERA5 historical bounds must remain inside the ERA5 processing domain",
    )
    validate_era5_bounds(
        RegionBounds(west=values[0], south=values[1], east=values[2], north=values[3])
    )
    return values, region_id


def _era5_active_lock_key() -> str:
    return os.getenv("ERA5_ACTIVE_LOCK_KEY", "radar/history/era5/active.json").strip()


def _claim_era5_job(client: Any, config: R2PublishConfig, job_id: str) -> None:
    key = _era5_active_lock_key()
    existing, etag = get_json_object_with_etag(client, config, key)
    now = datetime.now(timezone.utc)
    if existing and str(existing.get("status", "")).lower() in {"pending", "running"}:
        updated_raw = existing.get("updated_at")
        try:
            updated_at = parse_timestamp(str(updated_raw))
        except (TypeError, ValueError):
            updated_at = now
        if now - updated_at <= timedelta(hours=3):
            raise RuntimeError("An ERA5 historical job is already active; wait for it to finish")
    payload = {
        "job_id": job_id,
        "source": "era5",
        "status": "pending",
        "updated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        if etag:
            put_json_object(client, config, key, payload, if_match=etag)
        else:
            put_json_object(client, config, key, payload, if_none_match="*")
    except Exception as exc:
        if is_precondition_failed(exc):
            raise RuntimeError("An ERA5 historical job is already active; wait for it to finish") from exc
        raise


def _release_era5_job(client: Any, config: R2PublishConfig, job_id: str) -> None:
    key = _era5_active_lock_key()
    existing, etag = get_json_object_with_etag(client, config, key)
    if existing and existing.get("job_id") == job_id and etag:
        put_json_object(
            client,
            config,
            key,
            {
                "job_id": job_id,
                "source": "era5",
                "status": "complete",
                "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            if_match=etag,
        )


def _write_polling_state(enabled: bool) -> None:
    client, config = _r2_client()

    put_json_object(
        client,
        config,
        "control/polling.json",
        {"enabled": enabled, "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
    )


def _focus_control_key() -> str:
    return os.getenv("FOCUS_CONTROL_OBJECT_KEY", "control/focus.json").strip()


def _read_focus_state() -> dict:
    client, config = _r2_client()
    return get_json_object(client, config, _focus_control_key()) or {"enabled": False}


def _focus_state_is_active(state: dict, *, now: datetime | None = None) -> bool:
    try:
        return parse_focus_polling_state(state).is_active(now=now)
    except (TypeError, ValueError):
        return False


def _write_focus_state(state: dict) -> None:
    client, config = _r2_client()
    put_json_object(client, config, _focus_control_key(), state)


def _new_focus_state(payload: dict) -> dict:
    if "bounds" not in payload:
        raise ValueError("bounds are required when enabling storm focus")
    bounds, region_id = _mrms_bounds(payload)
    longitude_span = bounds[2] - bounds[0]
    latitude_span = bounds[3] - bounds[1]
    max_longitude_span = max(1.0, float(os.getenv("FOCUS_MAX_LONGITUDE_SPAN", "25")))
    max_latitude_span = max(1.0, float(os.getenv("FOCUS_MAX_LATITUDE_SPAN", "20")))
    if longitude_span > max_longitude_span or latitude_span > max_latitude_span:
        raise ValueError(
            f"Storm focus is limited to {max_longitude_span:g}° longitude by "
            f"{max_latitude_span:g}° latitude"
        )

    raw_label = str(payload.get("region_label", region_id.replace("-", " ").title()))
    region_label = " ".join(raw_label.split())
    if not region_label or len(region_label) > 64:
        raise ValueError("region_label must contain 1 to 64 characters")
    raw_duration = payload.get("duration_hours", 12)
    if isinstance(raw_duration, bool):
        raise ValueError("duration_hours must be an integer")
    if isinstance(raw_duration, float) and not raw_duration.is_integer():
        raise ValueError("duration_hours must be an integer")
    try:
        duration_hours = int(raw_duration)
    except (TypeError, ValueError) as exc:
        raise ValueError("duration_hours must be an integer") from exc
    maximum_hours = max(1, int(os.getenv("FOCUS_MAX_HOURS", "24")))
    if duration_hours < 1 or duration_hours > maximum_hours:
        raise ValueError(f"duration_hours must be between 1 and {maximum_hours}")

    now = datetime.now(timezone.utc)
    return {
        "enabled": True,
        "updated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (now + timedelta(hours=duration_hours)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "region_id": region_id,
        "region_label": region_label,
        "bounds": bounds,
    }


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "wallcloud-radar-admin"})


@app.post("/control/live")
def control_live():
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        return jsonify({"error": "enabled must be a boolean"}), 400
    try:
        if enabled:
            # Publish the gate before resuming so the first scheduled execution
            # cannot observe the old disabled state and exit unnecessarily.
            _write_polling_state(True)
            try:
                _set_live_scheduler_enabled(True)
            except Exception:
                _write_polling_state(False)
                raise
        else:
            _set_live_scheduler_enabled(False)
            _write_polling_state(False)
        return jsonify({"enabled": enabled})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.post("/control/focus")
def control_focus():
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        return jsonify({"error": "enabled must be a boolean"}), 400
    try:
        previous = _read_focus_state()
        was_active = _focus_state_is_active(previous)
        if enabled:
            state = _new_focus_state(payload)
            _write_focus_state(state)
            if not was_active:
                try:
                    _set_focus_scheduler_enabled(True)
                except Exception:
                    _write_focus_state(
                        {
                            "enabled": False,
                            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        }
                    )
                    raise
        else:
            _set_focus_scheduler_enabled(False)
            state = {
                "enabled": False,
                "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            _write_focus_state(state)
        return jsonify(state)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.post("/history/jobs")
def start_history_job():
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    source = str(payload.get("source", "mrms")).strip().lower()
    if source not in {"mrms", "krax", "era5"}:
        return jsonify({"error": "source must be mrms, krax, or era5"}), 400
    try:
        start = parse_timestamp(str(payload["start"]))
        end = parse_timestamp(str(payload["end"]))
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid historical timestamps: {exc}"}), 400
    if start >= end:
        return jsonify({"error": "start must be before end"}), 400
    max_hours_name = (
        "MRMS_HISTORY_MAX_HOURS"
        if source == "mrms"
        else "ERA5_HISTORY_MAX_HOURS"
        if source == "era5"
        else "HISTORY_MAX_HOURS"
    )
    max_hours = max(
        1,
        int(
            os.getenv(
                max_hours_name,
                "24" if source == "mrms" else str(ERA5_MAX_HOURS) if source == "era5" else "6",
            )
        ),
    )
    if end - start > timedelta(hours=max_hours):
        return jsonify({"error": f"Historical range is limited to {max_hours} hours"}), 400
    if source == "mrms":
        try:
            mrms_product_tier(start)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
    try:
        frame_limit = ERA5_MAX_FRAMES if source == "era5" else 90
        max_frames = max(1, min(frame_limit, int(payload.get("max_frames", 30))))
    except (TypeError, ValueError):
        return jsonify({"error": "max_frames must be an integer"}), 400
    bounds: list[float] | None = None
    region_id = "krax"
    if source == "mrms":
        try:
            bounds, region_id = _mrms_bounds(payload)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
    elif source == "era5":
        try:
            bounds, region_id = _era5_bounds(payload)
            validate_era5_request(
                start,
                end,
                RegionBounds(west=bounds[0], south=bounds[1], east=bounds[2], north=bounds[3]),
                max_frames=max_frames,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
    client, config = _r2_client()
    try:
        existing = _covering_history_entry(client, config, source, start, end, region_id, bounds)
    except Exception as exc:
        app.logger.warning("Unable to check the historical catalog before generation: %s", exc)
        existing = None
    if existing:
        return jsonify(
            {
                "error": "This date range is already available in the archive menu.",
                "status": "complete",
                "dataset_id": existing.get("id"),
                "manifest_url": existing.get("manifest_url"),
            }
        ), 409
    job_id = f"history-{uuid.uuid4().hex[:16]}"
    if not JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Unable to create a valid job id"}), 500
    if source == "era5":
        try:
            _claim_era5_job(client, config, job_id)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 409
    try:
        put_json_object(
            client,
            config,
            f"{_history_prefix(source)}/jobs/{job_id}.json",
            {
                "job_id": job_id,
                "status": "pending",
                "stage": "Queued",
                "source": source,
                "start": start.isoformat(),
                "end": end.isoformat(),
                **({"bounds": bounds, "region_id": region_id} if bounds else {}),
            },
        )
    except Exception as exc:
        if source == "era5":
            try:
                _release_era5_job(client, config, job_id)
            except Exception:
                pass
        return jsonify({"error": str(exc)}), 502
    job_name = (
        os.getenv("MRMS_HISTORY_JOB_NAME", "").strip()
        if source == "mrms"
        else ""
    ) or os.getenv("HISTORY_JOB_NAME", "wallcloud-krax-history").strip()
    environment = [
        {"name": "HISTORY_SOURCE", "value": source},
        {"name": "HISTORY_START", "value": start.isoformat()},
        {"name": "HISTORY_END", "value": end.isoformat()},
        {"name": "HISTORY_MAX_FRAMES", "value": str(max_frames)},
        {"name": "HISTORY_JOB_ID", "value": job_id},
    ]
    if bounds:
        environment.append({"name": "HISTORY_REGION_ID", "value": region_id})
        if source == "mrms":
            environment.extend(
                [
                    {"name": "MRMS_REGION_WEST", "value": str(bounds[0])},
                    {"name": "MRMS_REGION_SOUTH", "value": str(bounds[1])},
                    {"name": "MRMS_REGION_EAST", "value": str(bounds[2])},
                    {"name": "MRMS_REGION_NORTH", "value": str(bounds[3])},
                    {"name": "MRMS_INCLUDE_PRECIP_TYPE", "value": "true"},
                ]
            )
        elif source == "era5":
            environment.extend(
                [
                    {"name": "ERA5_REGION_WEST", "value": str(bounds[0])},
                    {"name": "ERA5_REGION_SOUTH", "value": str(bounds[1])},
                    {"name": "ERA5_REGION_EAST", "value": str(bounds[2])},
                    {"name": "ERA5_REGION_NORTH", "value": str(bounds[3])},
                ]
            )
    try:
        execution = _google_post(
            _run_job_url(job_name),
            {
                "overrides": {
                    "containerOverrides": [
                        {
                            "env": environment
                        }
                    ]
                }
            },
        )
    except Exception as exc:
        put_json_object(
            client,
            config,
            f"{_history_prefix(source)}/jobs/{job_id}.json",
            {"job_id": job_id, "source": source, "status": "failed", "message": str(exc)},
        )
        if source == "era5":
            try:
                _release_era5_job(client, config, job_id)
            except Exception:
                pass
        return jsonify({"error": str(exc)}), 502
    return jsonify({"job_id": job_id, "status": "running", "stage": "Queued", "execution": execution.get("name")}), 202


@app.get("/history/jobs/<job_id>")
def history_job_status(job_id: str):
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    if not JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Invalid job id"}), 400
    try:
        client, config = _r2_client()
        payload = None
        for prefix in ("radar/history/jobs", "radar/history/era5/jobs", "radar/krax/history/jobs"):
            payload = get_json_object(client, config, f"{prefix}/{job_id}.json")
            if payload is not None:
                break
        if payload is None:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
