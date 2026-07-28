from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from .config import NATIONAL_MRMS_REGION, RegionBounds


FOCUS_REGION_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
FOCUS_MAX_LONGITUDE_SPAN = 25.0
FOCUS_MAX_LATITUDE_SPAN = 20.0


@dataclass(frozen=True)
class FocusPollingState:
    """Validated administrator-selected regional MRMS polling state."""

    enabled: bool
    updated_at: datetime | None
    expires_at: datetime | None
    region_id: str | None
    region_label: str | None
    bounds: RegionBounds | None

    def is_active(self, *, now: datetime | None = None) -> bool:
        reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        return bool(
            self.enabled
            and self.bounds is not None
            and self.region_id
            and self.expires_at is not None
            and self.expires_at > reference
        )


def _parse_timestamp(value: object, field: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be an ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_focus_polling_state(payload: object) -> FocusPollingState:
    """Validate an R2 focus-control document and fail closed on malformed data."""

    if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
        raise ValueError("Focus polling state must include a boolean enabled value")
    updated_at = _parse_timestamp(payload.get("updated_at"), "updated_at")
    if not payload["enabled"]:
        return FocusPollingState(
            enabled=False,
            updated_at=updated_at,
            expires_at=None,
            region_id=None,
            region_label=None,
            bounds=None,
        )

    raw_bounds = payload.get("bounds")
    if not isinstance(raw_bounds, list) or len(raw_bounds) != 4:
        raise ValueError("Focus polling bounds must be [west, south, east, north]")
    try:
        west, south, east, north = (float(value) for value in raw_bounds)
    except (TypeError, ValueError) as exc:
        raise ValueError("Focus polling bounds must be numeric") from exc
    if west >= east or south >= north:
        raise ValueError("Focus polling bounds have an invalid geographic order")
    if (
        west < NATIONAL_MRMS_REGION.west
        or east > NATIONAL_MRMS_REGION.east
        or south < NATIONAL_MRMS_REGION.south
        or north > NATIONAL_MRMS_REGION.north
    ):
        raise ValueError("Focus polling bounds must remain inside the CONUS processing domain")
    if east - west > FOCUS_MAX_LONGITUDE_SPAN or north - south > FOCUS_MAX_LATITUDE_SPAN:
        raise ValueError(
            f"Focus polling bounds are limited to {FOCUS_MAX_LONGITUDE_SPAN:g}° longitude by "
            f"{FOCUS_MAX_LATITUDE_SPAN:g}° latitude"
        )

    region_id = payload.get("region_id")
    if not isinstance(region_id, str) or not FOCUS_REGION_ID_PATTERN.fullmatch(region_id):
        raise ValueError("Focus polling region_id is invalid")
    region_label = payload.get("region_label")
    if not isinstance(region_label, str) or not region_label.strip() or len(region_label.strip()) > 64:
        raise ValueError("Focus polling region_label must contain 1 to 64 characters")
    expires_at = _parse_timestamp(payload.get("expires_at"), "expires_at")
    if expires_at is None:
        raise ValueError("Focus polling expires_at is required while enabled")

    return FocusPollingState(
        enabled=True,
        updated_at=updated_at,
        expires_at=expires_at,
        region_id=region_id,
        region_label=region_label.strip(),
        bounds=RegionBounds(west=west, east=east, south=south, north=north),
    )


def fetch_polling_enabled(url: str | None = None, *, timeout: float | None = None) -> bool:
    """Read the live-ingestion switch, failing closed when a configured API fails.

    An unset URL intentionally preserves local/manual worker behavior. Production
    workers should set RADAR_CONTROL_STATUS_URL so a missing control response
    cannot unexpectedly start an expensive five-minute run.
    """
    endpoint = (url if url is not None else os.getenv("RADAR_CONTROL_STATUS_URL", "")).strip()
    if not endpoint:
        return True
    request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "wallcloud-radar-worker/1.0"})
    request_timeout = timeout if timeout is not None else float(os.getenv("RADAR_CONTROL_TIMEOUT_SECONDS", "10"))
    try:
        with urlopen(request, timeout=request_timeout) as response:  # noqa: S310 - URL is an explicit deployment setting.
            payload = json.load(response)
    except Exception as exc:
        raise RuntimeError(f"Radar polling control unavailable; skipping ingestion: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
        raise RuntimeError("Radar polling control returned invalid JSON; skipping ingestion")
    return payload["enabled"]
