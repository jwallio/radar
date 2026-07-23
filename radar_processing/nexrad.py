from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .config import NexradProcessingConfig


VOLUME_PATTERN = re.compile(
    r"^(?P<site>[A-Z0-9]{4})(?P<day>\d{8})_(?P<clock>\d{6})(?:_V\d+)?(?:\.gz)?$"
)


@dataclass(frozen=True)
class NexradVolume:
    site: str
    valid_time: datetime
    key: str
    filename: str
    url: str
    size: int | None = None

    @property
    def timestamp_iso(self) -> str:
        return self.valid_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_volume_time(filename: str, *, expected_site: str = "KRAX") -> datetime | None:
    match = VOLUME_PATTERN.fullmatch(Path(filename).name)
    if not match or match.group("site") != expected_site:
        return None
    return datetime.strptime(
        f"{match.group('day')}{match.group('clock')}",
        "%Y%m%d%H%M%S",
    ).replace(tzinfo=timezone.utc)


def request_bytes(url: str, config: NexradProcessingConfig) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/octet-stream, application/xml;q=0.9, */*;q=0.1",
            "User-Agent": "wall.cloud-radar/0.2 (KRAX NEXRAD Level II processor)",
        },
    )
    last_error: Exception | None = None
    for attempt in range(config.retries):
        try:
            with urlopen(request, timeout=config.timeout_seconds) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 < config.retries:
                time.sleep(min(2**attempt, 8))
    raise RuntimeError(f"Unable to download {url}: {last_error}") from last_error


def parse_archive_listing(
    payload: bytes,
    *,
    base_url: str,
    site: str = "KRAX",
) -> tuple[list[NexradVolume], str | None]:
    root = ET.fromstring(payload)
    volumes: list[NexradVolume] = []
    for content in root.findall(".//{*}Contents"):
        key = content.findtext("{*}Key")
        if not key:
            continue
        filename = Path(key).name
        valid_time = parse_volume_time(filename, expected_site=site)
        if valid_time is None:
            continue
        raw_size = content.findtext("{*}Size")
        volumes.append(
            NexradVolume(
                site=site,
                valid_time=valid_time,
                key=key,
                filename=filename,
                url=f"{base_url}/{quote(key, safe='/._-')}",
                size=int(raw_size) if raw_size and raw_size.isdigit() else None,
            )
        )
    return volumes, root.findtext(".//{*}NextContinuationToken")


def _dates(start: datetime, end: datetime) -> list[date]:
    current = start.date()
    result: list[date] = []
    while current <= end.date():
        result.append(current)
        current += timedelta(days=1)
    return result


def list_archive_volumes(
    config: NexradProcessingConfig,
    *,
    start: datetime,
    end: datetime,
) -> list[NexradVolume]:
    """List complete KRAX archive volumes from the public NOAA/Unidata S3 bucket."""

    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("NEXRAD archive timestamps must include a timezone")
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    if start_utc >= end_utc:
        raise ValueError("NEXRAD archive range start must be before end")

    volumes: list[NexradVolume] = []
    for day in _dates(start_utc, end_utc):
        prefix = f"{day:%Y/%m/%d}/{config.site}/"
        token: str | None = None
        while True:
            params = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
            if token:
                params["continuation-token"] = token
            listing_url = f"{config.archive_base_url}/?{urlencode(params)}"
            page, token = parse_archive_listing(
                request_bytes(listing_url, config),
                base_url=config.archive_base_url,
                site=config.site,
            )
            volumes.extend(volume for volume in page if start_utc <= volume.valid_time <= end_utc)
            if not token:
                break
    return sorted({volume.key: volume for volume in volumes}.values(), key=lambda volume: volume.valid_time)


def select_recent_volumes(
    volumes: list[NexradVolume],
    *,
    retention_minutes: int,
    max_frames: int,
) -> list[NexradVolume]:
    ordered = sorted(volumes, key=lambda volume: volume.valid_time)
    if not ordered:
        return []
    cutoff = ordered[-1].valid_time - timedelta(minutes=retention_minutes)
    return [volume for volume in ordered if volume.valid_time >= cutoff][-max_frames:]


def list_recent_volumes(
    config: NexradProcessingConfig,
    *,
    now: datetime | None = None,
) -> list[NexradVolume]:
    """List recent completed KRAX volumes, including the previous UTC day boundary."""

    reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    candidates = list_archive_volumes(
        config,
        start=reference - timedelta(days=1),
        end=reference + timedelta(minutes=2),
    )
    return select_recent_volumes(
        candidates,
        retention_minutes=config.retention_minutes,
        max_frames=config.max_frames,
    )


def sample_volumes(volumes: list[NexradVolume], max_frames: int) -> list[NexradVolume]:
    ordered = sorted(volumes, key=lambda volume: volume.valid_time)
    if len(ordered) <= max_frames:
        return ordered
    if max_frames <= 1:
        return [ordered[-1]]
    indices = {
        round(position * (len(ordered) - 1) / (max_frames - 1))
        for position in range(max_frames)
    }
    return [ordered[index] for index in sorted(indices)]


def download_volume(
    volume: NexradVolume,
    destination: Path,
    config: NexradProcessingConfig,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(f".{destination.name}.part")
    try:
        partial.write_bytes(request_bytes(volume.url, config))
        partial.replace(destination)
    finally:
        if partial.exists():
            partial.unlink()
