"""Resolve friendly Eastern Time workflow selections into ISO timestamps."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


EASTERN = ZoneInfo("America/New_York")
DATE_OFFSETS = {
    "today": 0,
    "yesterday": 1,
    "2-days-ago": 2,
    "3-days-ago": 3,
    "7-days-ago": 7,
}
END_OFFSETS_MINUTES = {
    "now": 0,
    "30-minutes-ago": 30,
    "1-hour-ago": 60,
    "2-hours-ago": 120,
    "3-hours-ago": 180,
    "6-hours-ago": 360,
}


def _parse_custom_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Custom date must use YYYY-MM-DD") from exc


def _parse_custom_time(value: str) -> tuple[int, int]:
    normalized = value.strip().upper()
    for pattern in ("%H:%M", "%I:%M %p", "%I %p"):
        try:
            parsed = datetime.strptime(normalized, pattern)
            return parsed.hour, parsed.minute
        except ValueError:
            continue
    raise ValueError("Custom ET time must use HH:MM, H:MM AM, or H AM")


def resolve_window(
    *,
    date_mode: str,
    end_mode: str,
    duration_minutes: int,
    now: datetime | None = None,
    custom_date: str | None = None,
    custom_end_time: str | None = None,
) -> tuple[datetime, datetime]:
    """Return a timezone-aware ET start/end pair for a workflow selection."""

    current = (now or datetime.now(EASTERN)).astimezone(EASTERN)
    if date_mode == "custom":
        if not custom_date:
            raise ValueError("Custom date is required when date mode is custom")
        anchor_date = _parse_custom_date(custom_date)
    elif date_mode in DATE_OFFSETS:
        anchor_date = current.date() - timedelta(days=DATE_OFFSETS[date_mode])
    else:
        raise ValueError(f"Unsupported date mode: {date_mode}")

    if end_mode == "custom":
        if not custom_end_time:
            raise ValueError("Custom ET time is required when end mode is custom")
        hour, minute = _parse_custom_time(custom_end_time)
        end = datetime(anchor_date.year, anchor_date.month, anchor_date.day, hour, minute, tzinfo=EASTERN)
    elif end_mode in END_OFFSETS_MINUTES:
        offset = END_OFFSETS_MINUTES[end_mode]
        if date_mode == "today":
            end = current - timedelta(minutes=offset)
        else:
            end = datetime(
                anchor_date.year,
                anchor_date.month,
                anchor_date.day,
                current.hour,
                current.minute,
                current.second,
                tzinfo=EASTERN,
            ) - timedelta(minutes=offset)
    else:
        raise ValueError(f"Unsupported end mode: {end_mode}")

    if duration_minutes < 1:
        raise ValueError("Duration must be at least one minute")
    start = end - timedelta(minutes=duration_minutes)
    return start, end


def _iso(value: datetime) -> str:
    return value.astimezone(EASTERN).isoformat(timespec="seconds")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date-mode", required=True)
    parser.add_argument("--end-mode", required=True)
    parser.add_argument("--duration-minutes", required=True, type=int)
    parser.add_argument("--custom-date")
    parser.add_argument("--custom-end-time")
    args = parser.parse_args()

    start, end = resolve_window(
        date_mode=args.date_mode,
        end_mode=args.end_mode,
        duration_minutes=args.duration_minutes,
        custom_date=args.custom_date,
        custom_end_time=args.custom_end_time,
    )
    print(f"start_et={_iso(start)}")
    print(f"end_et={_iso(end)}")
    print(f"start_utc={start.astimezone(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ')}")
    print(f"end_utc={end.astimezone(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ')}")
    print(f"window_label={_iso(start)} to {_iso(end)} ET")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
