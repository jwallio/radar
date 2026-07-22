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

from .config import ProcessingConfig, ProductDefinition


TIMESTAMP_PATTERN = re.compile(r"_(?:\d{2}\.\d{2})_(\d{8}-\d{6})\.grib2\.gz$")
HREF_PATTERN = re.compile(r'href=["\']([^"\']+\.grib2\.gz)["\']', re.IGNORECASE)


@dataclass(frozen=True)
class RemoteFrame:
    valid_time: datetime
    filename: str
    url: str

    @property
    def timestamp_iso(self) -> str:
        return self.valid_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_filename_time(filename: str) -> datetime | None:
    match = TIMESTAMP_PATTERN.search(filename)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)


def request_bytes(url: str, config: ProcessingConfig) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/octet-stream, text/html;q=0.9, */*;q=0.1",
            "User-Agent": "wall.cloud-radar/0.1 (MRMS regional processor)",
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


def list_product_frames(product: ProductDefinition, config: ProcessingConfig) -> list[RemoteFrame]:
    """Read the official MRMS directory listing and return timestamped files."""

    directory_url = f"{config.mrms_base_url}/{product.directory}/"
    html = request_bytes(directory_url, config).decode("utf-8", errors="replace")
    names = {
        Path(href).name
        for href in HREF_PATTERN.findall(html)
        if Path(href).name.startswith(product.filename_prefix)
    }
    frames: list[RemoteFrame] = []
    for filename in names:
        valid_time = parse_filename_time(filename)
        if valid_time is None:
            continue
        frames.append(RemoteFrame(valid_time, filename, f"{directory_url}{filename}"))
    return sorted(frames, key=lambda frame: frame.valid_time)


def select_recent_frames(
    frames: list[RemoteFrame],
    *,
    retention_minutes: int,
    max_frames: int,
) -> list[RemoteFrame]:
    if not frames:
        return []
    ordered = sorted(frames, key=lambda frame: frame.valid_time)
    newest = ordered[-1].valid_time
    cutoff = newest - timedelta(minutes=retention_minutes)
    recent = [frame for frame in ordered if frame.valid_time >= cutoff]
    return recent[-max_frames:]


def sample_frames(frames: list[RemoteFrame], max_frames: int) -> list[RemoteFrame]:
    """Evenly sample a requested archive range while preserving both endpoints."""

    ordered = sorted(frames, key=lambda frame: frame.valid_time)
    if len(ordered) <= max_frames:
        return ordered
    if max_frames <= 1:
        return [ordered[-1]]
    indices = {
        round(position * (len(ordered) - 1) / (max_frames - 1))
        for position in range(max_frames)
    }
    return [ordered[index] for index in sorted(indices)]


def _archive_listing(payload: bytes, base_url: str) -> tuple[list[RemoteFrame], str | None]:
    root = ET.fromstring(payload)
    frames: list[RemoteFrame] = []
    for content in root.findall(".//{*}Contents"):
        key = content.findtext("{*}Key")
        if not key:
            continue
        filename = Path(key).name
        valid_time = parse_filename_time(filename)
        if valid_time is None:
            continue
        frames.append(
            RemoteFrame(
                valid_time=valid_time,
                filename=filename,
                url=f"{base_url}/{quote(key, safe='/._-')}",
            )
        )
    token = root.findtext(".//{*}NextContinuationToken")
    return frames, token


def _archive_dates(start: datetime, end: datetime) -> list[date]:
    current = start.date()
    dates: list[date] = []
    while current <= end.date():
        dates.append(current)
        current += timedelta(days=1)
    return dates


def list_archive_frames(
    product: ProductDefinition,
    config: ProcessingConfig,
    *,
    start: datetime,
    end: datetime,
) -> list[RemoteFrame]:
    """List a UTC range from NOAA's public NODD MRMS archive."""

    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("Archive range timestamps must include a timezone")
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    if start_utc >= end_utc:
        raise ValueError("Archive range start must be before end")

    frames: list[RemoteFrame] = []
    for day in _archive_dates(start_utc, end_utc):
        prefix = f"{product.archive_prefix}/{day:%Y%m%d}/"
        token: str | None = None
        while True:
            params = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
            if token:
                params["continuation-token"] = token
            listing_url = f"{config.mrms_archive_base_url}/?{urlencode(params)}"
            page_frames, token = _archive_listing(request_bytes(listing_url, config), config.mrms_archive_base_url)
            frames.extend(
                frame
                for frame in page_frames
                if start_utc <= frame.valid_time <= end_utc
                and frame.filename.startswith(product.filename_prefix)
            )
            if not token:
                break
    return sorted({frame.url: frame for frame in frames}.values(), key=lambda frame: frame.valid_time)


def match_closest_frame(
    target: datetime,
    candidates: list[RemoteFrame],
    *,
    max_delta_seconds: int = 180,
) -> RemoteFrame | None:
    if not candidates:
        return None
    closest = min(candidates, key=lambda frame: abs((frame.valid_time - target).total_seconds()))
    return closest if abs((closest.valid_time - target).total_seconds()) <= max_delta_seconds else None


def download_file(url: str, destination: Path, config: ProcessingConfig) -> None:
    """Download atomically so a failed transfer cannot be decoded as a real file."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    payload = request_bytes(url, config)
    partial.write_bytes(payload)
    partial.replace(destination)
