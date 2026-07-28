from __future__ import annotations

import logging
import os
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import google.auth
import requests
from google.auth.transport.requests import Request as GoogleAuthRequest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import PRODUCTS, load_config  # noqa: E402
from radar_processing.control import FocusPollingState, parse_focus_polling_state  # noqa: E402
from radar_processing.manifest import write_json_atomic  # noqa: E402
from radar_processing.mrms import list_product_frames, select_recent_frames  # noqa: E402
from radar_processing.national_tiles import build_focus_mrms_dataset, select_incremental_frames  # noqa: E402
from radar_processing.pipeline import REFLECTIVITY_ID  # noqa: E402
from radar_processing.r2 import (  # noqa: E402
    R2PublishConfig,
    create_r2_client,
    get_json_object,
    get_json_object_with_etag,
    is_precondition_failed,
    publish_directory,
    prune_old_frames,
    put_json_object,
)


LOGGER = logging.getLogger("wallcloud.radar.cloudrun.mrms-focus")
GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


def _utc_timestamp(value: datetime | None = None) -> str:
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _scheduler_resource_url() -> str:
    project = os.getenv("GCP_PROJECT_ID", "").strip()
    if not project:
        raise RuntimeError("GCP_PROJECT_ID is required to auto-pause expired storm focus polling")
    region = os.getenv("GCP_REGION", "us-east1").strip()
    job = os.getenv("FOCUS_SCHEDULER_JOB", "wallcloud-focus-refresh").strip()
    name = f"projects/{project}/locations/{region}/jobs/{job}"
    return f"https://cloudscheduler.googleapis.com/v1/{name}"


def _scheduler_url(action: str) -> str:
    return f"{_scheduler_resource_url()}:{action}"


def _scheduler_request(method: str, url: str) -> dict:
    credentials, _ = google.auth.default(scopes=[GOOGLE_SCOPE])
    credentials.refresh(GoogleAuthRequest())
    response = requests.request(
        method,
        url,
        headers={"Authorization": f"Bearer {credentials.token}", "Content-Type": "application/json"},
        json={} if method == "POST" else None,
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Cloud Scheduler returned HTTP {response.status_code}: {response.text[:500]}")
    return response.json() if response.content else {}


def _set_scheduler_enabled(enabled: bool) -> None:
    state = _scheduler_request("GET", _scheduler_resource_url()).get("state")
    if state not in {"ENABLED", "PAUSED"}:
        raise RuntimeError(f"Cloud Scheduler returned an unexpected state: {state or 'missing'}")
    if enabled and state == "PAUSED":
        _scheduler_request("POST", _scheduler_url("resume"))
    elif not enabled and state == "ENABLED":
        _scheduler_request("POST", _scheduler_url("pause"))


def _read_focus_state(
    client,
    r2_config: R2PublishConfig,
    control_key: str,
) -> tuple[FocusPollingState | None, str | None]:
    raw_state, etag = get_json_object_with_etag(client, r2_config, control_key)
    return (parse_focus_polling_state(raw_state) if raw_state is not None else None), etag


def _matches_focus_version(
    current: FocusPollingState | None,
    current_etag: str | None,
    expected: FocusPollingState,
    expected_etag: str,
) -> bool:
    return current == expected and current_etag == expected_etag


def _disable_expired_focus(
    client,
    r2_config: R2PublishConfig,
    state: FocusPollingState,
    *,
    control_key: str,
    expected_etag: str,
) -> bool:
    current, current_etag = _read_focus_state(client, r2_config, control_key)
    if not _matches_focus_version(current, current_etag, state, expected_etag) or (
        current is not None and current.is_active()
    ):
        return False

    _set_scheduler_enabled(False)
    current, current_etag = _read_focus_state(client, r2_config, control_key)
    if not _matches_focus_version(current, current_etag, state, expected_etag):
        if current is not None and current.is_active():
            _set_scheduler_enabled(True)
        return False

    try:
        put_json_object(
            client,
            r2_config,
            control_key,
            {
                "enabled": False,
                "updated_at": _utc_timestamp(),
                "expired_region_id": state.region_id,
            },
            if_match=expected_etag,
        )
    except Exception as exc:
        if not is_precondition_failed(exc):
            raise
        latest, _latest_etag = _read_focus_state(client, r2_config, control_key)
        if latest is not None and latest.is_active():
            _set_scheduler_enabled(True)
        return False
    return True


def _same_focus(manifest: dict | None, state: FocusPollingState) -> bool:
    if not isinstance(manifest, dict) or state.bounds is None:
        return False
    region = manifest.get("region")
    return bool(
        manifest.get("region_id") == state.region_id
        and isinstance(region, dict)
        and [
            region.get("west"),
            region.get("south"),
            region.get("east"),
            region.get("north"),
        ]
        == state.bounds.as_list()
    )


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    try:
        os.environ["MRMS_INCLUDE_PRECIP_TYPE"] = "false"
        r2_config = R2PublishConfig.from_env()
        client = create_r2_client(r2_config)
        control_key = os.getenv("FOCUS_CONTROL_OBJECT_KEY", "control/focus.json").strip()
        state, state_etag = _read_focus_state(client, r2_config, control_key)
        if state is None:
            LOGGER.info("Storm focus has never been configured; nothing to refresh")
            return 0
        if not state.enabled:
            LOGGER.info("Storm focus polling is disabled; nothing to refresh")
            return 0
        if not state_etag:
            raise RuntimeError("Storm focus control object did not include an ETag")
        if not state.is_active():
            disabled = _disable_expired_focus(
                client,
                r2_config,
                state,
                control_key=control_key,
                expected_etag=state_etag,
            )
            if disabled:
                LOGGER.info("Storm focus %s expired and its Scheduler was paused", state.region_id)
            else:
                LOGGER.info("Storm focus changed while expiry was being handled; leaving the newer state intact")
            return 0
        if state.bounds is None or state.expires_at is None or not state.region_id or not state.region_label:
            raise RuntimeError("Enabled storm focus state is incomplete")

        config = replace(load_config(ROOT), region=state.bounds)
        existing = get_json_object(client, r2_config, "radar/focus/manifest.json")
        if not _same_focus(existing, state):
            existing = None
        candidates = list_product_frames(PRODUCTS[REFLECTIVITY_ID], config)
        selected = select_recent_frames(
            candidates,
            retention_minutes=config.retention_minutes,
            max_frames=config.max_frames,
        )
        if not selected:
            raise RuntimeError("The official MRMS directory returned no reflectivity frames")
        selected = select_incremental_frames(selected, existing)
        expires_at = _utc_timestamp(state.expires_at)
        min_zoom = _env_int("MRMS_FOCUS_TILE_MIN_ZOOM", 4, minimum=0)
        max_zoom = _env_int("MRMS_FOCUS_TILE_MAX_ZOOM", 10, minimum=0)
        if min_zoom > max_zoom:
            raise ValueError("MRMS_FOCUS_TILE_MIN_ZOOM cannot exceed MRMS_FOCUS_TILE_MAX_ZOOM")
        manifest = build_focus_mrms_dataset(
            config,
            selected,
            region=state.bounds,
            region_id=state.region_id,
            region_label=state.region_label,
            expires_at=expires_at,
            existing_manifest=existing,
            trust_existing_assets=True,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
            workers=_env_int("MRMS_TILE_WORKERS", 2),
        )
        status_path = config.output_dir / "focus" / "worker-status.json"
        write_json_atomic(
            status_path,
            {
                "worker": "wallcloud-mrms-focus",
                "generated_at": _utc_timestamp(),
                "ok": True,
                "region_id": state.region_id,
                "region_label": state.region_label,
                "expires_at": expires_at,
                "latest_valid_time": manifest.get("latest_valid_time"),
                "frame_count": len(manifest.get("frames", [])),
            },
        )
        current, current_etag = _read_focus_state(client, r2_config, control_key)
        if not _matches_focus_version(current, current_etag, state, state_etag) or (
            current is not None and not current.is_active()
        ):
            if _matches_focus_version(current, current_etag, state, state_etag) and current is not None:
                _disable_expired_focus(
                    client,
                    r2_config,
                    current,
                    control_key=control_key,
                    expected_etag=state_etag,
                )
            LOGGER.info("Storm focus changed or expired during processing; skipping stale publication")
            return 0
        keys = publish_directory(
            client,
            r2_config,
            ROOT / "public" / "data",
            include_prefixes=("radar/focus",),
        )
        LOGGER.info("Published %d storm-focus MRMS objects for %s", len(keys), state.region_id)
        LOGGER.info("Pruned %d expired live radar objects", len(prune_old_frames(client, r2_config)))
        return 0
    except Exception:
        LOGGER.exception("Storm-focus MRMS refresh failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
