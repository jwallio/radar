from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


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
