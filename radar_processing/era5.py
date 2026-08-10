from __future__ import annotations

"""Official CDS ERA5 hourly precipitation ingestion and reconstruction."""

import hashlib
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np

from .animation import build_loop_gif
from .config import ATLANTIC_CARIBBEAN_REGION, RegionBounds
from .era5_rendering import ERA5_NATIVE_RESOLUTION, render_era5_frame
from .history import catalog_entry, update_history_catalog
from .manifest import write_json_atomic


LOGGER = logging.getLogger("wallcloud.radar.era5")
ERA5_CDS_DATASET = "reanalysis-era5-single-levels"
ERA5_CDS_API_URL = "https://cds.climate.copernicus.eu/api"
ERA5_RECONSTRUCTION_VERSION = 1
ERA5_MAX_HOURS = 7 * 24
ERA5_MAX_FRAMES = 7 * 24
ERA5_MIN_TIME = datetime(1940, 1, 1, tzinfo=timezone.utc)
# ERA5 is used for the broader hurricane corridor; it extends beyond the
# observed CONUS MRMS grid into the Caribbean and western Atlantic.
ERA5_PROCESSING_BOUNDS = RegionBounds(west=-130.0, east=-55.0, south=10.0, north=55.0)
ERA5_CONUS_BOUNDS = ERA5_PROCESSING_BOUNDS  # compatibility alias for existing callers
ERA5_DEFAULT_REGION = ATLANTIC_CARIBBEAN_REGION
ERA5_MAX_LONGITUDE_SPAN = 70.0
ERA5_MAX_LATITUDE_SPAN = 40.0
ERA5_SOURCE_LABEL = "ERA5 • Copernicus Climate Change Service / ECMWF"
ERA5_SOURCE_URL = "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels"
ERA5_API_DOCUMENTATION_URL = "https://cds.climate.copernicus.eu/how-to-api"
ERA5_METHODOLOGY = (
    "Reanalysis-based reconstruction — not observed radar. ERA5 precipitation_type "
    "selects the ECMWF phase class and hourly total_precipitation supplies the "
    "mm/hour intensity. Frames are exact hourly source fields; no five-minute "
    "interpolation or dBZ conversion is applied."
)
REGION_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")

StageCallback = Callable[[str], None]


@dataclass(frozen=True)
class Era5HourlyGrid:
    valid_time: datetime
    precipitation_type: np.ndarray
    total_precipitation: np.ndarray
    latitudes: np.ndarray
    longitudes: np.ndarray


def normalize_era5_region_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value).strip().lower()).strip("-") or "view"
    if not REGION_ID_PATTERN.fullmatch(normalized):
        raise ValueError("ERA5 region_id is invalid")
    return normalized


def validate_era5_bounds(bounds: RegionBounds) -> None:
    if bounds.west >= bounds.east or bounds.south >= bounds.north:
        raise ValueError("ERA5 bounds have an invalid geographic order")
    if (
        bounds.west < ERA5_PROCESSING_BOUNDS.west
        or bounds.east > ERA5_PROCESSING_BOUNDS.east
        or bounds.south < ERA5_PROCESSING_BOUNDS.south
        or bounds.north > ERA5_PROCESSING_BOUNDS.north
    ):
        raise ValueError("ERA5 historical bounds must remain inside the ERA5 processing domain")
    if bounds.east - bounds.west > ERA5_MAX_LONGITUDE_SPAN or bounds.north - bounds.south > ERA5_MAX_LATITUDE_SPAN:
        raise ValueError(
            f"ERA5 historical bounds are limited to {ERA5_MAX_LONGITUDE_SPAN:g}° longitude by "
            f"{ERA5_MAX_LATITUDE_SPAN:g}° latitude"
        )


def expected_era5_hours(start: datetime, end: datetime) -> list[datetime]:
    return [
        start + timedelta(hours=offset)
        for offset in range(int((end - start).total_seconds() // 3600))
    ]


def validate_era5_request(
    start: datetime,
    end: datetime,
    bounds: RegionBounds,
    *,
    max_frames: int = ERA5_MAX_FRAMES,
    now: datetime | None = None,
) -> int:
    """Validate an exact-hour, bounded, non-future ERA5 request."""

    start = start.astimezone(timezone.utc)
    end = end.astimezone(timezone.utc)
    if start < ERA5_MIN_TIME:
        raise ValueError("ERA5 history is available from 1940-01-01 UTC")
    if start >= end:
        raise ValueError("ERA5 start must be before end")
    if start.minute or start.second or start.microsecond or end.minute or end.second or end.microsecond:
        raise ValueError("ERA5 requests must start and end on whole UTC hours")
    if end - start > timedelta(hours=ERA5_MAX_HOURS):
        raise ValueError(f"ERA5 historical ranges are limited to {ERA5_MAX_HOURS} hours")
    reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if end > reference:
        raise ValueError("ERA5 historical requests cannot include future hours")
    validate_era5_bounds(bounds)
    try:
        max_frames_value = int(max_frames)
    except (TypeError, ValueError) as exc:
        raise ValueError("ERA5 max_frames must be an integer") from exc
    frame_count = len(expected_era5_hours(start, end))
    if not 1 <= max_frames_value <= ERA5_MAX_FRAMES:
        raise ValueError(f"ERA5 max_frames must be between 1 and {ERA5_MAX_FRAMES}")
    if frame_count > max_frames_value:
        raise ValueError(f"ERA5 hourly output requires max_frames of at least {frame_count}")
    return frame_count


def era5_dataset_id(
    start: datetime,
    end: datetime,
    region_id: str,
    bounds: RegionBounds,
    *,
    version: int = ERA5_RECONSTRUCTION_VERSION,
) -> str:
    """Build a deterministic cache key including source, time, region, and version."""

    normalized_region = normalize_era5_region_id(region_id)
    start_token = start.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    end_token = end.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    bounds_token = ",".join(f"{value:.4f}" for value in bounds.as_list())
    digest = hashlib.sha256(f"{normalized_region}|{bounds_token}".encode("ascii")).hexdigest()[:10]
    return f"era5-{normalized_region}-{start_token}-{end_token}-b{digest}-v{version}"


def _month_groups(start: datetime, end: datetime) -> list[tuple[int, int, list[int], list[int]]]:
    """Group requested hours so CDS boundary-day requests do not over-fetch."""

    day_hours: dict[tuple[int, int, int], set[int]] = {}
    for timestamp in expected_era5_hours(start, end):
        day_hours.setdefault((timestamp.year, timestamp.month, timestamp.day), set()).add(timestamp.hour)
    # Merge days with matching requested hour sets.  A CDS request applies the
    # same time list to every requested day, so this preserves exact boundaries
    # while still using one request for complete multi-day hourly periods.
    by_month: dict[tuple[int, int], dict[tuple[int, ...], set[int]]] = {}
    for (year, month, day), hours in day_hours.items():
        by_month.setdefault((year, month), {}).setdefault(tuple(sorted(hours)), set()).add(day)
    return [
        (year, month, sorted(days), list(hours))
        for (year, month), hour_groups in sorted(by_month.items())
        for hours, days in sorted(hour_groups.items())
    ]


def build_cds_request(
    year: int,
    month: int,
    days: Iterable[int],
    bounds: RegionBounds,
    *,
    hours: Iterable[int] | None = None,
) -> dict[str, Any]:
    """Build the current CDS API request shape for the ERA5 single-level dataset."""

    validate_era5_bounds(bounds)
    return {
        "product_type": ["reanalysis"],
        "variable": ["precipitation_type", "total_precipitation"],
        "year": [f"{year:04d}"],
        "month": [f"{month:02d}"],
        "day": [f"{day:02d}" for day in sorted(set(days))],
        "time": [f"{hour:02d}:00" for hour in sorted(set(hours if hours is not None else range(24)))],
        # CDS area ordering is North, West, South, East.
        "area": [bounds.north, bounds.west, bounds.south, bounds.east],
        "data_format": "grib",
        # Keep the response as a raw GRIB stream. The current CDS API may
        # otherwise wrap a multi-variable request in an archive that cfgrib
        # cannot discover as hourly fields.
        "download_format": "unarchived",
    }


def cds_client_from_env() -> Any:
    """Create the official cdsapi client without writing credentials to disk."""

    api_key = (os.getenv("CDSAPI_KEY") or os.getenv("ERA5_CDS_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ERA5 CDS credentials are not configured (CDSAPI_KEY is required)")
    try:
        import cdsapi
    except ImportError as exc:  # pragma: no cover - deployment dependency check
        raise RuntimeError("cdsapi is required for ERA5 processing; install cdsapi>=0.7.7") from exc
    return cdsapi.Client(
        url=(os.getenv("CDSAPI_URL") or ERA5_CDS_API_URL).strip() or ERA5_CDS_API_URL,
        key=api_key,
        quiet=True,
    )


def download_era5_months(
    client: Any,
    start: datetime,
    end: datetime,
    bounds: RegionBounds,
    raw_dir: Path,
) -> list[Path]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    bounds_token = "_".join(f"{value:.2f}".replace("-", "m").replace(".", "p") for value in bounds.as_list())
    for year, month, days, hours in _month_groups(start, end):
        days_token = "-".join(f"{day:02d}" for day in days)
        hours_token = "-".join(f"{hour:02d}" for hour in hours)
        target = raw_dir / f"era5-{year:04d}{month:02d}-d{days_token}-h{hours_token}-{bounds_token}.grib"
        request = build_cds_request(year, month, days, bounds, hours=hours)
        if not target.is_file() or target.stat().st_size == 0:
            LOGGER.info(
                "Requesting ERA5 %04d-%02d for %d day(s), %d hour(s)",
                year,
                month,
                len(days),
                len(hours),
            )
            client.retrieve(ERA5_CDS_DATASET, request, str(target))
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError(f"CDS returned no ERA5 file for {year:04d}-{month:02d}")
        paths.append(target)
    return paths


def _as_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if hasattr(value, "to_pydatetime"):
        return _as_datetime(value.to_pydatetime())
    if isinstance(value, np.datetime64):
        if np.isnat(value):
            return None
        micros = int((value.astype("datetime64[us]") - np.datetime64("1970-01-01", "us")) / np.timedelta64(1, "us"))
        return datetime.fromtimestamp(micros / 1_000_000, tz=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _step_hours(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, np.timedelta64):
        return float(value / np.timedelta64(1, "h"))
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _scalar_coordinate(data: Any, name: str) -> Any:
    coordinate = data.coords.get(name)
    if coordinate is None:
        return None
    values = np.asarray(coordinate.values)
    return values.reshape(-1)[0] if values.size else None


def _slice_timestamp(data: Any) -> datetime | None:
    valid_time = _as_datetime(_scalar_coordinate(data, "valid_time"))
    if valid_time is not None:
        return valid_time
    base_time = _as_datetime(_scalar_coordinate(data, "time"))
    if base_time is None:
        return _as_datetime(data.attrs.get("valid_time"))
    step = _step_hours(_scalar_coordinate(data, "step"))
    return base_time + timedelta(hours=step or 0.0)


def _coordinate(data: Any, names: tuple[str, ...]) -> tuple[str, np.ndarray] | None:
    for name in names:
        coordinate = data.coords.get(name)
        if coordinate is not None and coordinate.ndim == 1:
            return name, np.asarray(coordinate.values, dtype=np.float64)
    return None


def _find_variable(dataset: Any, kind: str) -> Any | None:
    names = {"ptype": {"ptype", "precipitation_type"}, "tp": {"tp", "total_precipitation"}}[kind]
    param_ids = {"ptype": {260015}, "tp": {228}}[kind]
    for name, variable in dataset.data_vars.items():
        short_name = str(variable.attrs.get("GRIB_shortName", "")).lower()
        standard_name = str(variable.attrs.get("standard_name", "")).lower()
        try:
            param_id = int(variable.attrs.get("GRIB_paramId"))
        except (TypeError, ValueError):
            param_id = None
        if name.lower() in names or short_name in names or standard_name in names or param_id in param_ids:
            return variable
    return None


def _iter_variable_slices(variable: Any) -> Iterable[tuple[datetime, np.ndarray, np.ndarray, np.ndarray]]:
    latitude = _coordinate(variable, ("latitude", "lat"))
    longitude = _coordinate(variable, ("longitude", "lon"))
    if latitude is None or longitude is None:
        raise ValueError("ERA5 GRIB field has no one-dimensional latitude/longitude coordinates")
    latitude_name, latitudes = latitude
    longitude_name, longitudes = longitude
    # CDS/cfgrib can expose the same longitude grid as either -180..180 or
    # 0..360 depending on the GRIB edition used for a variable.  Keep the
    # public ERA5 grid in the signed representation so companion fields align.
    longitudes = ((longitudes + 180.0) % 360.0) - 180.0
    non_spatial = [dimension for dimension in variable.dims if dimension not in {latitude_name, longitude_name}]
    shapes = [int(variable.sizes[dimension]) for dimension in non_spatial]
    indices: Iterable[tuple[int, ...]] = np.ndindex(*shapes) if shapes else [()]
    for index in indices:
        indexers = {dimension: offset for dimension, offset in zip(non_spatial, index)}
        # Keep scalar cfgrib coordinates such as valid_time and step after
        # selecting a single forecast slice.  Dropping them makes ERA5
        # precipitation fields fall back to the forecast base time instead
        # of their actual hourly validity time.
        sliced = variable.isel(indexers, drop=False).transpose(latitude_name, longitude_name)
        timestamp = _slice_timestamp(sliced)
        if timestamp is None:
            raise ValueError("ERA5 GRIB field has no valid timestamp")
        values = np.asarray(np.ma.filled(sliced.values, np.nan), dtype=np.float32)
        yield timestamp, values, latitudes, longitudes


def _read_era5_grib(paths: Iterable[Path]) -> tuple[dict[datetime, tuple[np.ndarray, np.ndarray, np.ndarray]], dict[datetime, tuple[np.ndarray, np.ndarray, np.ndarray]]]:
    """Decode ptype and tp hypercubes using ecCodes/cfgrib."""

    try:
        import cfgrib
    except ImportError as exc:  # pragma: no cover - deployment dependency check
        raise RuntimeError("cfgrib and ecCodes are required to decode ERA5 GRIB") from exc

    ptype_fields: dict[datetime, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    tp_fields: dict[datetime, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    parameter_specs = (("ptype", ptype_fields, 260015), ("tp", tp_fields, 228))
    for path in paths:
        for kind, destination, param_id in parameter_specs:
            # Keep the two fields in separate cfgrib hypercubes. They have
            # different step types (instantaneous vs accumulated), and a
            # mixed open can otherwise discard one of the valid fields.
            datasets = cfgrib.open_datasets(
                str(path),
                backend_kwargs={"indexpath": "", "filter_by_keys": {"paramId": param_id}},
            )
            try:
                for dataset in datasets:
                    variable = _find_variable(dataset, kind)
                    if variable is None and len(dataset.data_vars) == 1:
                        variable = next(iter(dataset.data_vars.values()))
                    if variable is None:
                        continue
                    for timestamp, values, latitudes, longitudes in _iter_variable_slices(variable):
                        # The first exact field is retained if CDS exposes the
                        # same valid time in more than one GRIB hypercube.
                        destination.setdefault(timestamp, (values, latitudes, longitudes))
            finally:
                for dataset in datasets:
                    dataset.close()
    return ptype_fields, tp_fields


def load_era5_hourly_grids(paths: Iterable[Path], start: datetime, end: datetime) -> list[Era5HourlyGrid]:
    ptype_fields, tp_fields = _read_era5_grib(paths)
    grids: list[Era5HourlyGrid] = []
    missing: list[str] = []
    for timestamp in expected_era5_hours(start, end):
        ptype = ptype_fields.get(timestamp)
        total = tp_fields.get(timestamp)
        if ptype is None or total is None:
            missing.append(timestamp.strftime("%Y-%m-%dT%H:%MZ"))
            continue
        ptype_values, ptype_lats, ptype_lons = ptype
        total_values, total_lats, total_lons = total
        if ptype_values.shape != total_values.shape or not np.allclose(ptype_lats, total_lats) or not np.allclose(ptype_lons, total_lons):
            raise ValueError(f"ERA5 fields are not aligned at {timestamp.isoformat()}")
        grids.append(Era5HourlyGrid(timestamp, ptype_values, total_values, ptype_lats, ptype_lons))
    if missing:
        preview = ", ".join(missing[:4])
        suffix = "…" if len(missing) > 4 else ""
        decoded_ptype = ", ".join(timestamp.strftime("%Y-%m-%dT%H:%MZ") for timestamp in sorted(ptype_fields)[:4]) or "none"
        decoded_total = ", ".join(timestamp.strftime("%Y-%m-%dT%H:%MZ") for timestamp in sorted(tp_fields)[:4]) or "none"
        raise RuntimeError(
            "ERA5 did not return required hourly ptype and total precipitation fields: "
            f"{preview}{suffix}; decoded ptype={decoded_ptype}; decoded tp={decoded_total}"
        )
    return grids


def _stage(callback: StageCallback | None, value: str) -> None:
    if callback is not None:
        callback(value)


def _frame_payload(prefix: str, timestamp: datetime, filename: str, bounds: list[float]) -> dict[str, Any]:
    stamp = timestamp.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    return {
        "id": f"{prefix}-{stamp}",
        "valid_time": timestamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "url": f"./frames/{filename}",
        "bounds": bounds,
    }


def _complete_manifest(path: Path, dataset_id: str) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        import json

        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if (
        isinstance(payload, dict)
        and payload.get("status") == "ready"
        and payload.get("dataset_id") == dataset_id
        and payload.get("source") == "era5"
        and payload.get("observed") is False
        and payload.get("era5_reconstruction_version") == ERA5_RECONSTRUCTION_VERSION
    ):
        return payload
    return None


def build_era5_dataset(
    *,
    root: Path,
    output_root: Path,
    start: datetime,
    end: datetime,
    bounds: RegionBounds,
    region_id: str,
    max_frames: int = ERA5_MAX_FRAMES,
    label: str | None = None,
    keep_raw: bool = False,
    client: Any | None = None,
    stage_callback: StageCallback | None = None,
) -> dict[str, Any]:
    """Download, decode, render, and catalog one bounded ERA5 hourly pack."""

    frame_count = validate_era5_request(start, end, bounds, max_frames=max_frames)
    normalized_region = normalize_era5_region_id(region_id)
    dataset_id = era5_dataset_id(start, end, normalized_region, bounds)
    dataset_dir = output_root / dataset_id
    cached = _complete_manifest(dataset_dir / "manifest.json", dataset_id)
    if cached is not None:
        update_history_catalog(output_root / "catalog.json", catalog_entry(cached))
        _stage(stage_callback, "Complete")
        return cached

    output_root.mkdir(parents=True, exist_ok=True)
    frame_dir = dataset_dir / "frames"
    loop_dir = dataset_dir / "loops"
    frame_dir.mkdir(parents=True, exist_ok=True)
    loop_dir.mkdir(parents=True, exist_ok=True)
    scratch = root / ".radar-tmp"
    scratch.mkdir(parents=True, exist_ok=True)
    raw_context = tempfile.TemporaryDirectory(prefix="wallcloud-era5-", dir=scratch) if not keep_raw else None
    raw_dir = Path(raw_context.name) if raw_context else root / ".era5-raw"
    try:
        _stage(stage_callback, "Requesting ERA5")
        cds_client = client or cds_client_from_env()
        _stage(stage_callback, "Downloading reanalysis")
        source_files = download_era5_months(cds_client, start, end, bounds, raw_dir)
        _stage(stage_callback, "Processing precipitation type")
        grids = load_era5_hourly_grids(source_files, start, end)
        if len(grids) != frame_count:
            raise RuntimeError(f"ERA5 returned {len(grids)} frames; expected {frame_count}")

        _stage(stage_callback, "Rendering frames")
        phase_frames: list[dict[str, Any]] = []
        total_frames: list[dict[str, Any]] = []
        rendered_width = 0
        rendered_height = 0
        for grid in grids:
            stamp = grid.valid_time.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
            phase_name = f"era5-precipitation-type-{stamp}.png"
            total_name = f"era5-total-precipitation-{stamp}.png"
            rendered = render_era5_frame(
                grid.precipitation_type,
                grid.total_precipitation,
                grid.latitudes,
                grid.longitudes,
                region=bounds,
                phase_output_path=frame_dir / phase_name,
                total_output_path=frame_dir / total_name,
            )
            rendered_width = rendered.phase.width
            rendered_height = rendered.phase.height
            phase_frames.append(_frame_payload("era5-phase", grid.valid_time, phase_name, rendered.phase.manifest_bounds()))
            total_frames.append(_frame_payload("era5-total", grid.valid_time, total_name, rendered.total_precipitation.manifest_bounds()))

        products: dict[str, dict[str, Any]] = {
            "ERA5PrecipitationType": {
                "label": "Precipitation phase & intensity",
                "status": "ready",
                "frames": phase_frames,
                "source_url": ERA5_SOURCE_URL,
                "notes": ERA5_METHODOLOGY,
            },
            "ERA5TotalPrecipitation": {
                "label": "Total precipitation · hourly",
                "status": "ready",
                "frames": total_frames,
                "source_url": ERA5_SOURCE_URL,
                "notes": "Hourly total precipitation accumulation in mm/hour from ERA5; no radar reflectivity is inferred.",
            },
        }
        loop_cache_key = dataset_id
        loop_definitions = (
            ("ERA5PrecipitationType", phase_frames, "era5-precipitation-phase.gif", "PHASE"),
            ("ERA5TotalPrecipitation", total_frames, "era5-total-precipitation.gif", "mm/h"),
        )
        for product_id, frames, loop_name, unit in loop_definitions:
            loop_path = loop_dir / loop_name
            build_loop_gif(
                frames,
                frame_dir,
                loop_path,
                bounds=bounds,
                source_bounds=bounds,
                product_id=product_id,
                product_label=str(products[product_id]["label"]),
                source_label=ERA5_SOURCE_LABEL,
                resolution_label="0.25° native",
                unit_label=unit,
                mode_label="REANALYSIS",
            )
            products[product_id].update(
                loop_url=f"./loops/{loop_name}?v={loop_cache_key}",
                loop_frame_count=len(frames),
                loop_size_bytes=loop_path.stat().st_size,
            )

        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        phase_bounds = phase_frames[0]["bounds"]
        manifest: dict[str, Any] = {
            "schema_version": 1,
            "status": "ready",
            "mode": "historical",
            "source": "era5",
            "source_type": "reanalysis",
            "observed": False,
            "dataset_id": dataset_id,
            "label": label or f"ERA5 · {normalized_region} · {start:%Y-%m-%d %H:%MZ}–{end:%Y-%m-%d %H:%MZ}",
            "region_id": normalized_region,
            "region_label": normalized_region.replace("-", " ").title(),
            "generated_at": generated_at,
            "latest_valid_time": phase_frames[-1]["valid_time"],
            "start_time": start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end_time": end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "region": {
                "west": float(bounds.west),
                "south": float(bounds.south),
                "east": float(bounds.east),
                "north": float(bounds.north),
            },
            "bounds": bounds.as_list(),
            "product_type": "historical_precipitation_reconstruction",
            "product": "ERA5PrecipitationType",
            "products": products,
            "frames": phase_frames,
            "sources": {
                "era5_cds_dataset": ERA5_SOURCE_URL,
                "era5_cds_api": ERA5_CDS_API_URL,
                "era5_api_documentation": ERA5_API_DOCUMENTATION_URL,
            },
            "variables": ["precipitation_type", "total_precipitation"],
            "temporal_resolution": "hourly",
            "temporal_interpolation": "none",
            "native_resolution": ERA5_NATIVE_RESOLUTION,
            "rendered_resolution": f"native source grid rendered as {rendered_width}×{rendered_height} PNG pixels",
            "provenance": ERA5_SOURCE_LABEL,
            "methodology": ERA5_METHODOLOGY,
            "era5_reconstruction_version": ERA5_RECONSTRUCTION_VERSION,
            "errors": [],
        }
        if not isinstance(phase_bounds, list) or len(phase_bounds) != 4:
            raise RuntimeError("ERA5 rendered frame has invalid bounds")
        write_json_atomic(dataset_dir / "manifest.json", manifest)
        update_history_catalog(output_root / "catalog.json", catalog_entry(manifest))
        _stage(stage_callback, "Complete")
        return manifest
    finally:
        if raw_context:
            raw_context.cleanup()
