from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from scripts.resolve_history_window import resolve_window


EASTERN = ZoneInfo("America/New_York")


def test_recent_window_uses_current_eastern_time() -> None:
    now = datetime(2026, 7, 23, 8, 40, 12, tzinfo=EASTERN)
    start, end = resolve_window(date_mode="today", end_mode="now", duration_minutes=90, now=now)
    assert start.isoformat() == "2026-07-23T07:10:12-04:00"
    assert end.isoformat() == "2026-07-23T08:40:12-04:00"


def test_relative_archive_selection_handles_dst_in_eastern_time() -> None:
    now = datetime(2026, 7, 23, 8, 40, tzinfo=EASTERN)
    start, end = resolve_window(date_mode="yesterday", end_mode="2-hours-ago", duration_minutes=180, now=now)
    assert start.isoformat() == "2026-07-22T03:40:00-04:00"
    assert end.isoformat() == "2026-07-22T06:40:00-04:00"


def test_custom_date_and_time_are_converted_without_manual_iso_format() -> None:
    start, end = resolve_window(
        date_mode="custom",
        end_mode="custom",
        custom_date="2025-06-19",
        custom_end_time="3:30 PM",
        duration_minutes=90,
    )
    assert start.isoformat() == "2025-06-19T14:00:00-04:00"
    assert end.isoformat() == "2025-06-19T15:30:00-04:00"


def test_custom_values_are_required() -> None:
    with pytest.raises(ValueError, match="Custom date"):
        resolve_window(date_mode="custom", end_mode="now", duration_minutes=60)
    with pytest.raises(ValueError, match="Custom ET time"):
        resolve_window(date_mode="today", end_mode="custom", duration_minutes=60)
