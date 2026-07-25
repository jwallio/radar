from __future__ import annotations

import io

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
