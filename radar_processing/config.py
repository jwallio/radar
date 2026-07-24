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
    render_kind: str = "scalar"


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


@dataclass(frozen=True)
class NexradProcessingConfig:
    """Settings for the single-site KRAX NEXRAD Level II processor."""

    root: Path
    output_dir: Path
    history_dir: Path
    temp_dir: Path
    archive_base_url: str
    realtime_chunks_base_url: str
    site: str
    region: RegionBounds
    retention_minutes: int
    max_frames: int
    timeout_seconds: float
    retries: int
    image_width: int
    keep_raw: bool
    raw_dir: Path | None


PRODUCTS: dict[str, ProductDefinition] = {
    "MergedReflectivityQCComposite": ProductDefinition(
        product_id="MergedReflectivityQCComposite",
        label="Composite Reflectivity",
        directory="MergedReflectivityQCComposite",
        filename_prefix="MRMS_MergedReflectivityQCComposite",
        archive_prefix="CONUS/MergedReflectivityQCComposite_00.50",
        render_kind="reflectivity",
    ),
    "PrecipFlag": ProductDefinition(
        product_id="PrecipFlag",
        label="Precipitation Type",
        directory="PrecipFlag",
        filename_prefix="MRMS_PrecipFlag",
        archive_prefix="CONUS/PrecipFlag_00.00",
        render_kind="precip_type",
    ),
    "MultiSensor_QPE_01H_Pass1": ProductDefinition(
        product_id="MultiSensor_QPE_01H_Pass1",
        label="Rainfall · 1 hour",
        directory="MultiSensor_QPE_01H_Pass1",
        filename_prefix="MRMS_MultiSensor_QPE_01H_Pass1",
        archive_prefix="CONUS/MultiSensor_QPE_01H_Pass1",
        render_kind="qpe",
    ),
    "MergedAzShear_0-2kmAGL": ProductDefinition(
        product_id="MergedAzShear_0-2kmAGL",
        label="Low-level Azimuthal Shear",
        directory="MergedAzShear_0-2kmAGL",
        filename_prefix="MRMS_MergedAzShear_0-2kmAGL",
        archive_prefix="CONUS/MergedAzShear_0-2kmAGL_00.50",
        render_kind="azshear",
    ),
    "MergedAzShear_3-6kmAGL": ProductDefinition(
        product_id="MergedAzShear_3-6kmAGL",
        label="Mid-level Azimuthal Shear",
        directory="MergedAzShear_3-6kmAGL",
        filename_prefix="MRMS_MergedAzShear_3-6kmAGL",
        archive_prefix="CONUS/MergedAzShear_3-6kmAGL_00.50",
        render_kind="azshear",
    ),
    "RotationTrack30min": ProductDefinition(
        product_id="RotationTrack30min",
        label="Rotation Track · 30 min",
        directory="RotationTrack30min",
        filename_prefix="MRMS_RotationTrack30min",
        archive_prefix="CONUS/RotationTrack30min_00.50",
        render_kind="rotation",
    ),
    "MESH": ProductDefinition(
        product_id="MESH",
        label="MESH · estimated hail size",
        directory="MESH",
        filename_prefix="MRMS_MESH",
        archive_prefix="CONUS/MESH_00.50",
        render_kind="mesh",
    ),
    "POSH": ProductDefinition(
        product_id="POSH",
        label="POSH · severe hail probability",
        directory="POSH",
        filename_prefix="MRMS_POSH",
        archive_prefix="CONUS/POSH_00.50",
        render_kind="posh",
    ),
    "NLDN_CG_005min_AvgDensity": ProductDefinition(
        product_id="NLDN_CG_005min_AvgDensity",
        label="Lightning · 5 min density",
        directory="NLDN_CG_005min_AvgDensity",
        filename_prefix="MRMS_NLDN_CG_005min_AvgDensity",
        archive_prefix="CONUS/NLDN_CG_005min_AvgDensity_00.00",
        render_kind="lightning",
    ),
}

PRIMARY_PRODUCT_IDS: tuple[str, ...] = ("MergedReflectivityQCComposite", "PrecipFlag")
ANALYSIS_PRODUCT_IDS: tuple[str, ...] = (
    "MultiSensor_QPE_01H_Pass1",
    "MergedAzShear_0-2kmAGL",
    "MergedAzShear_3-6kmAGL",
    "RotationTrack30min",
    "MESH",
    "POSH",
    "NLDN_CG_005min_AvgDensity",
)

DEFAULT_REGION = RegionBounds(west=-86.5, east=-73.5, south=32.5, north=39.5)
# The live raster stays regional so upstream weather remains visible in the
# viewer. Downloadable branded loops use a tighter Central NC framing instead
# of forcing the share image to show the full processing domain.
BRANDED_GIF_REGION = RegionBounds(west=-83.3, east=-74.8, south=33.6, north=37.0)
DEFAULT_MRMS_BASE_URL = "https://mrms.ncep.noaa.gov/2D"
DEFAULT_MRMS_ARCHIVE_BASE_URL = "https://noaa-mrms-pds.s3.amazonaws.com"
DEFAULT_NEXRAD_ARCHIVE_BASE_URL = "https://unidata-nexrad-level2.s3.amazonaws.com"
DEFAULT_NEXRAD_REALTIME_CHUNKS_BASE_URL = "https://unidata-nexrad-level2-chunks.s3.amazonaws.com"
KRAX_SITE = "KRAX"
KRAX_REGION = RegionBounds(west=-84.5, east=-74.0, south=33.0, north=38.0)


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


def load_nexrad_config(root: Path, *, keep_raw: bool | None = None) -> NexradProcessingConfig:
    """Load KRAX Level II settings without coupling them to MRMS configuration."""

    site = os.getenv("NEXRAD_SITE", KRAX_SITE).strip().upper()
    if site != KRAX_SITE:
        raise ValueError(f"This MVP supports KRAX only, received NEXRAD_SITE={site!r}")
    output_dir = root / "public" / "data" / "radar" / "krax"
    keep = bool(keep_raw) if keep_raw is not None else _env_bool("NEXRAD_KEEP_RAW", False)
    region = RegionBounds(
        west=_env_float("NEXRAD_REGION_WEST", KRAX_REGION.west),
        east=_env_float("NEXRAD_REGION_EAST", KRAX_REGION.east),
        south=_env_float("NEXRAD_REGION_SOUTH", KRAX_REGION.south),
        north=_env_float("NEXRAD_REGION_NORTH", KRAX_REGION.north),
    )
    if region.west >= region.east or region.south >= region.north:
        raise ValueError(f"Invalid NEXRAD region bounds: {region}")
    return NexradProcessingConfig(
        root=root,
        output_dir=output_dir,
        history_dir=output_dir / "history",
        temp_dir=root / ".radar-tmp",
        archive_base_url=os.getenv("NEXRAD_ARCHIVE_BASE_URL", DEFAULT_NEXRAD_ARCHIVE_BASE_URL).rstrip("/"),
        realtime_chunks_base_url=os.getenv(
            "NEXRAD_REALTIME_CHUNKS_BASE_URL",
            DEFAULT_NEXRAD_REALTIME_CHUNKS_BASE_URL,
        ).rstrip("/"),
        site=site,
        region=region,
        retention_minutes=max(1, _env_int("NEXRAD_RETENTION_MINUTES", 90)),
        max_frames=max(1, _env_int("NEXRAD_MAX_FRAMES", 18)),
        timeout_seconds=max(5.0, _env_float("NEXRAD_TIMEOUT_SECONDS", 60.0)),
        retries=max(1, _env_int("NEXRAD_RETRIES", 3)),
        image_width=max(320, _env_int("NEXRAD_IMAGE_WIDTH", 2400)),
        keep_raw=keep,
        raw_dir=root / ".nexrad-raw" if keep else None,
    )
