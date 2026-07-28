from __future__ import annotations

import io
from datetime import datetime, timezone

import pytest

from radar_processing import control


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def test_unconfigured_control_preserves_local_worker_behavior(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RADAR_CONTROL_STATUS_URL", raising=False)
    assert control.fetch_polling_enabled() is True


def test_control_reads_enabled_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(control, "urlopen", lambda request, timeout: FakeResponse(b'{"enabled": false}'))
    assert control.fetch_polling_enabled("https://control.example/status") is False


def test_control_fails_closed_on_bad_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(control, "urlopen", lambda request, timeout: FakeResponse(b'{"state": "on"}'))
    with pytest.raises(RuntimeError, match="invalid JSON"):
        control.fetch_polling_enabled("https://control.example/status")


def test_control_fails_closed_on_network_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(request, timeout):
        raise OSError("offline")

    monkeypatch.setattr(control, "urlopen", fail)
    with pytest.raises(RuntimeError, match="unavailable"):
        control.fetch_polling_enabled("https://control.example/status")


def test_focus_control_state_validates_region_and_expiration() -> None:
    state = control.parse_focus_polling_state(
        {
            "enabled": True,
            "updated_at": "2026-07-28T12:00:00Z",
            "expires_at": "2026-07-29T00:00:00Z",
            "region_id": "southeast",
            "region_label": "Southeast",
            "bounds": [-91.5, 24.0, -74.0, 37.8],
        }
    )

    assert state.region_id == "southeast"
    assert state.bounds is not None
    assert state.bounds.as_list() == [-91.5, 24.0, -74.0, 37.8]
    assert state.is_active(now=datetime(2026, 7, 28, 18, tzinfo=timezone.utc))
    assert not state.is_active(now=datetime(2026, 7, 29, 1, tzinfo=timezone.utc))


def test_focus_control_state_fails_closed_on_unbounded_or_incomplete_state() -> None:
    with pytest.raises(ValueError, match="inside the CONUS"):
        control.parse_focus_polling_state(
            {
                "enabled": True,
                "expires_at": "2026-07-29T00:00:00Z",
                "region_id": "bad",
                "region_label": "Bad",
                "bounds": [-140, 20, -60, 55],
            }
        )
    with pytest.raises(ValueError, match="limited to"):
        control.parse_focus_polling_state(
            {
                "enabled": True,
                "expires_at": "2026-07-29T00:00:00Z",
                "region_id": "too-large",
                "region_label": "Too Large",
                "bounds": [-120, 25, -90, 45],
            }
        )
    with pytest.raises(ValueError, match="expires_at"):
        control.parse_focus_polling_state(
            {
                "enabled": True,
                "region_id": "southeast",
                "region_label": "Southeast",
                "bounds": [-91.5, 24.0, -74.0, 37.8],
            }
        )
