from __future__ import annotations

from typing import Any

import pytest

from radar_processing.control import FocusPollingState, parse_focus_polling_state
from scripts import run_cloud_run_mrms_focus as focus_job


def _state(
    *,
    region_id: str = "southeast",
    expires_at: str = "2020-01-01T00:00:00Z",
) -> FocusPollingState:
    return parse_focus_polling_state(
        {
            "enabled": True,
            "updated_at": "2026-07-28T12:00:00Z",
            "expires_at": expires_at,
            "region_id": region_id,
            "region_label": region_id.replace("-", " ").title(),
            "bounds": [-91.5, 24.0, -74.0, 37.8],
        }
    )


def test_focus_version_requires_matching_state_and_etag() -> None:
    expected = _state()

    assert focus_job._matches_focus_version(expected, '"old"', expected, '"old"')
    assert not focus_job._matches_focus_version(expected, '"new"', expected, '"old"')
    assert not focus_job._matches_focus_version(
        _state(region_id="central-plains"),
        '"old"',
        expected,
        '"old"',
    )


def test_expiry_does_not_disable_a_region_selected_during_scheduler_pause(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expired = _state()
    replacement = _state(region_id="central-plains", expires_at="2099-01-01T00:00:00Z")
    reads = iter([(expired, '"old"'), (replacement, '"new"')])
    scheduler_changes: list[bool] = []
    monkeypatch.setattr(focus_job, "_read_focus_state", lambda *_args: next(reads))
    monkeypatch.setattr(
        focus_job,
        "_set_scheduler_enabled",
        lambda enabled: scheduler_changes.append(enabled),
    )
    monkeypatch.setattr(
        focus_job,
        "put_json_object",
        lambda *_args, **_kwargs: pytest.fail("the replacement state must not be overwritten"),
    )

    disabled = focus_job._disable_expired_focus(
        object(),
        object(),
        expired,
        control_key="control/focus.json",
        expected_etag='"old"',
    )

    assert disabled is False
    assert scheduler_changes == [False, True]


def test_expiry_recovers_when_conditional_write_loses_the_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class PreconditionFailed(Exception):
        response: dict[str, Any] = {
            "Error": {"Code": "PreconditionFailed"},
            "ResponseMetadata": {"HTTPStatusCode": 412},
        }

    expired = _state()
    replacement = _state(region_id="central-plains", expires_at="2099-01-01T00:00:00Z")
    reads = iter([(expired, '"old"'), (expired, '"old"'), (replacement, '"new"')])
    scheduler_changes: list[bool] = []
    monkeypatch.setattr(focus_job, "_read_focus_state", lambda *_args: next(reads))
    monkeypatch.setattr(
        focus_job,
        "_set_scheduler_enabled",
        lambda enabled: scheduler_changes.append(enabled),
    )
    monkeypatch.setattr(
        focus_job,
        "put_json_object",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(PreconditionFailed()),
    )

    disabled = focus_job._disable_expired_focus(
        object(),
        object(),
        expired,
        control_key="control/focus.json",
        expected_etag='"old"',
    )

    assert disabled is False
    assert scheduler_changes == [False, True]
