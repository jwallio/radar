from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RegionBounds:
    """Geographic bounds in decimal degrees."""

    west: float
    east: float
    south: float
    north: float

    def as_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]


@dataclass(frozen=True)
class ProductDefinition:
    product_id: str
    label: str
    directory: str
    filename_prefix: str
    archive_prefix: str


@dataclass(frozen=True)
class ProcessingConfig:
    root: Path
    output_dir: Path
    frame_dir: Path
    temp_dir: Path
    mrms_base_url: str
    mrms_archive_base_url: str
    region: RegionBounds
    retention_minutes: int
    max_frames: int
    timeout_seconds: float
    retries: int
    include_precip_type: bool
    keep_raw: bool
    raw_dir: Path | None


PRODUCTS: dict[str, ProductDefinition] = {
    "MergedReflectivityQCComposite": ProductDefinition(
        product_id="MergedReflectivityQCComposite",
        label="Composite Reflectivity",
        directory="MergedReflectivityQCComposite",
        filename_prefix="MRMS_MergedReflectivityQCComposite",
        archive_prefix="CONUS/MergedReflectivityQCComposite_00.50",
    ),
    "PrecipFlag": ProductDefinition(
        product_id="PrecipFlag",
        label="Precipitation Type",
        directory="PrecipFlag",
        filename_prefix="MRMS_PrecipFlag",
        archive_prefix="CONUS/PrecipFlag_00.00",
    ),
}

DEFAULT_REGION = RegionBounds(west=-86.5, east=-73.5, south=32.5, north=39.5)
DEFAULT_MRMS_BASE_URL = "https://mrms.ncep.noaa.gov/2D"
DEFAULT_MRMS_ARCHIVE_BASE_URL = "https://noaa-mrms-pds.s3.amazonaws.com"


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric, received {value!r}") from exc


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, received {value!r}") from exc


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_config(root: Path, *, keep_raw: bool | None = None) -> ProcessingConfig:
    """Load processing settings from environment variables with safe defaults."""

    output_dir = root / "public" / "data" / "radar"
    frame_dir = output_dir / "frames"
    temp_dir = root / ".radar-tmp"
    raw_dir = root / ".radar-raw" if (keep_raw or _env_bool("MRMS_KEEP_RAW", False)) else None
    region = RegionBounds(
        west=_env_float("MRMS_REGION_WEST", DEFAULT_REGION.west),
        east=_env_float("MRMS_REGION_EAST", DEFAULT_REGION.east),
        south=_env_float("MRMS_REGION_SOUTH", DEFAULT_REGION.south),
        north=_env_float("MRMS_REGION_NORTH", DEFAULT_REGION.north),
    )
    if region.west >= region.east or region.south >= region.north:
        raise ValueError(f"Invalid MRMS region bounds: {region}")

    return ProcessingConfig(
        root=root,
        output_dir=output_dir,
        frame_dir=frame_dir,
        temp_dir=temp_dir,
        mrms_base_url=os.getenv("MRMS_BASE_URL", DEFAULT_MRMS_BASE_URL).rstrip("/"),
        mrms_archive_base_url=os.getenv("MRMS_ARCHIVE_BASE_URL", DEFAULT_MRMS_ARCHIVE_BASE_URL).rstrip("/"),
        region=region,
        retention_minutes=max(1, _env_int("MRMS_RETENTION_MINUTES", 90)),
        max_frames=max(1, _env_int("MRMS_MAX_FRAMES", 30)),
        timeout_seconds=max(5.0, _env_float("MRMS_TIMEOUT_SECONDS", 45.0)),
        retries=max(1, _env_int("MRMS_RETRIES", 3)),
        include_precip_type=_env_bool("MRMS_INCLUDE_PRECIP_TYPE", True),
        keep_raw=bool(keep_raw) if keep_raw is not None else _env_bool("MRMS_KEEP_RAW", False),
        raw_dir=raw_dir,
    )
