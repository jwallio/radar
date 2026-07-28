from __future__ import annotations

import hmac
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import google.auth
import requests
from flask import Flask, jsonify, request
from google.auth.transport.requests import Request as GoogleAuthRequest

from radar_processing.history import parse_timestamp
from radar_processing.r2 import R2PublishConfig, create_r2_client, get_json_object, put_json_object


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


def _project() -> str:
    value = os.getenv("GCP_PROJECT_ID", "").strip()
    if not value:
        raise RuntimeError("GCP_PROJECT_ID is not configured")
    return value


def _region() -> str:
    return os.getenv("GCP_REGION", "us-east1").strip()


def _scheduler_url(action: str) -> str:
    job = os.getenv("LIVE_SCHEDULER_JOB", "wallcloud-live-refresh").strip()
    name = f"projects/{_project()}/locations/{_region()}/jobs/{job}"
    return f"https://cloudscheduler.googleapis.com/v1/{name}:{action}"


def _focus_scheduler_url(action: str) -> str:
    job = os.getenv("FOCUS_SCHEDULER_JOB", "wallcloud-focus-refresh").strip()
    name = f"projects/{_project()}/locations/{_region()}/jobs/{job}"
    return f"https://cloudscheduler.googleapis.com/v1/{name}:{action}"


def _run_job_url(job_name: str) -> str:
    encoded = quote(job_name, safe="")
    return f"https://run.googleapis.com/v2/projects/{_project()}/locations/{_region()}/jobs/{encoded}:run"


def _r2_client():
    config = R2PublishConfig.from_env()
    return create_r2_client(config), config


def _history_prefix(source: str) -> str:
    return "radar/history" if source == "mrms" else "radar/krax/history"


def _mrms_bounds(payload: dict) -> tuple[list[float], str]:
    raw = payload.get("bounds", list(MRMS_CONUS_BOUNDS))
    if not isinstance(raw, list) or len(raw) != 4:
        raise ValueError("bounds must be [west, south, east, north]")
    try:
        west, south, east, north = (float(value) for value in raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("bounds values must be numeric") from exc
    conus_west, conus_south, conus_east, conus_north = MRMS_CONUS_BOUNDS
    if west >= east or south >= north:
        raise ValueError("bounds have an invalid geographic order")
    if west < conus_west or east > conus_east or south < conus_south or north > conus_north:
        raise ValueError("MRMS historical bounds must remain inside the CONUS processing domain")
    region_id = re.sub(r"[^a-z0-9]+", "-", str(payload.get("region_id", "view")).lower()).strip("-") or "view"
    if not REGION_ID_PATTERN.fullmatch(region_id):
        raise ValueError("region_id is invalid")
    return [west, south, east, north], region_id


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
                _google_post(_scheduler_url("resume"))
            except Exception:
                _write_polling_state(False)
                raise
        else:
            _google_post(_scheduler_url("pause"))
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
        was_enabled = previous.get("enabled") is True
        if enabled:
            state = _new_focus_state(payload)
            _write_focus_state(state)
            if not was_enabled:
                try:
                    _google_post(_focus_scheduler_url("resume"))
                except Exception:
                    _write_focus_state(
                        {
                            "enabled": False,
                            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        }
                    )
                    raise
        else:
            if was_enabled:
                _google_post(_focus_scheduler_url("pause"))
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
    if source not in {"mrms", "krax"}:
        return jsonify({"error": "source must be mrms or krax"}), 400
    try:
        start = parse_timestamp(str(payload["start"]))
        end = parse_timestamp(str(payload["end"]))
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid historical timestamps: {exc}"}), 400
    if start >= end:
        return jsonify({"error": "start must be before end"}), 400
    max_hours_name = "MRMS_HISTORY_MAX_HOURS" if source == "mrms" else "HISTORY_MAX_HOURS"
    max_hours = max(1, int(os.getenv(max_hours_name, "24" if source == "mrms" else "6")))
    if end - start > timedelta(hours=max_hours):
        return jsonify({"error": f"Historical range is limited to {max_hours} hours"}), 400
    try:
        max_frames = max(1, min(90, int(payload.get("max_frames", 30))))
    except (TypeError, ValueError):
        return jsonify({"error": "max_frames must be an integer"}), 400
    bounds: list[float] | None = None
    region_id = "krax"
    if source == "mrms":
        try:
            bounds, region_id = _mrms_bounds(payload)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
    job_id = f"history-{uuid.uuid4().hex[:16]}"
    if not JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Unable to create a valid job id"}), 500
    client, config = _r2_client()
    put_json_object(
        client,
        config,
        f"{_history_prefix(source)}/jobs/{job_id}.json",
        {
            "job_id": job_id,
            "status": "pending",
            "source": source,
            "start": start.isoformat(),
            "end": end.isoformat(),
            **({"bounds": bounds, "region_id": region_id} if bounds else {}),
        },
    )
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
        environment.extend(
            [
                {"name": "HISTORY_REGION_ID", "value": region_id},
                {"name": "MRMS_REGION_WEST", "value": str(bounds[0])},
                {"name": "MRMS_REGION_SOUTH", "value": str(bounds[1])},
                {"name": "MRMS_REGION_EAST", "value": str(bounds[2])},
                {"name": "MRMS_REGION_NORTH", "value": str(bounds[3])},
                {"name": "MRMS_INCLUDE_PRECIP_TYPE", "value": "true"},
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
        return jsonify({"error": str(exc)}), 502
    return jsonify({"job_id": job_id, "status": "running", "execution": execution.get("name")}), 202


@app.get("/history/jobs/<job_id>")
def history_job_status(job_id: str):
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    if not JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Invalid job id"}), 400
    try:
        client, config = _r2_client()
        payload = get_json_object(client, config, f"radar/history/jobs/{job_id}.json")
        if payload is None:
            payload = get_json_object(client, config, f"radar/krax/history/jobs/{job_id}.json")
        if payload is None:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
