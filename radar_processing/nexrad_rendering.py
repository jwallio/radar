from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .config import RegionBounds
from .rendering import RenderedRaster, reflectivity_rgba


FIELD_ALIASES = ("reflectivity", "REF", "reflectivity_horizontal")


@dataclass(frozen=True)
class NexradRadarMetadata:
    field_name: str
    sweep_count: int
    radar_latitude: float
    radar_longitude: float
    elevation_degrees: float


def _mercator(latitude: np.ndarray | float) -> np.ndarray:
    radians = np.deg2rad(np.clip(latitude, -85.0, 85.0))
    return np.log(np.tan(np.pi / 4.0 + radians / 2.0))


def raster_height(region: RegionBounds, width: int) -> int:
    longitude_span = math.radians(region.east - region.west)
    latitude_span = float(_mercator(region.north) - _mercator(region.south))
    return max(240, round(width * latitude_span / longitude_span))


def grid_reflectivity(
    gate_longitude: np.ndarray,
    gate_latitude: np.ndarray,
    reflectivity: np.ndarray | np.ma.MaskedArray[Any, Any],
    region: RegionBounds,
    *,
    width: int,
) -> np.ndarray:
    """Project polar radar gates onto a Web-Mercator-aligned max-reflectivity grid."""

    height = raster_height(region, width)
    values = np.asarray(np.ma.filled(reflectivity, np.nan), dtype=np.float32)
    longitudes = np.asarray(gate_longitude, dtype=np.float64)
    latitudes = np.asarray(gate_latitude, dtype=np.float64)
    if values.shape != longitudes.shape or values.shape != latitudes.shape:
        raise ValueError("NEXRAD reflectivity and gate-coordinate arrays do not share one shape")

    valid = (
        np.isfinite(values)
        & np.isfinite(longitudes)
        & np.isfinite(latitudes)
        & (values >= -20.0)
        & (values <= 100.0)
        & (longitudes >= region.west)
        & (longitudes <= region.east)
        & (latitudes >= region.south)
        & (latitudes <= region.north)
    )
    if not np.any(valid):
        raise ValueError("The KRAX volume contains no reflectivity gates inside the configured region")

    x = np.rint((longitudes[valid] - region.west) / (region.east - region.west) * (width - 1)).astype(np.int64)
    north_y = float(_mercator(region.north))
    south_y = float(_mercator(region.south))
    gate_y = _mercator(latitudes[valid])
    y = np.rint((north_y - gate_y) / (north_y - south_y) * (height - 1)).astype(np.int64)
    x = np.clip(x, 0, width - 1)
    y = np.clip(y, 0, height - 1)

    grid = np.full((height, width), -999.0, dtype=np.float32)
    np.maximum.at(grid.ravel(), y * width + x, values[valid])

    # Close only one-pixel radial gaps. Existing gates keep their original
    # value; the neighborhood maximum is used exclusively where no gate landed.
    padded = np.pad(grid, 1, constant_values=-999.0)
    neighbors = np.maximum.reduce(
        [padded[row:row + height, column:column + width] for row in range(3) for column in range(3)]
    )
    grid = np.where(grid > -900.0, grid, neighbors)
    grid[grid <= -900.0] = np.nan
    return grid


def _field_name(radar: Any) -> str:
    for name in FIELD_ALIASES:
        if name in radar.fields:
            return name
    available = ", ".join(sorted(radar.fields))
    raise ValueError(f"KRAX volume has no supported reflectivity field; available fields: {available}")


def render_level2_reflectivity(
    input_path: Path,
    output_path: Path,
    region: RegionBounds,
    *,
    width: int = 1200,
) -> tuple[RenderedRaster, NexradRadarMetadata]:
    """Decode a NEXRAD Archive II volume and render a composite reflectivity raster."""

    try:
        import pyart
    except ImportError as exc:  # pragma: no cover - exercised by deployment smoke tests
        raise RuntimeError("Py-ART is required; install requirements-nexrad.txt") from exc

    radar = pyart.io.read_nexrad_archive(str(input_path), delay_field_loading=False)
    field_name = _field_name(radar)
    radar.init_gate_longitude_latitude()
    lowest_sweep = radar.get_slice(0)
    values = radar.fields[field_name]["data"][lowest_sweep]
    grid = grid_reflectivity(
        radar.gate_longitude["data"][lowest_sweep],
        radar.gate_latitude["data"][lowest_sweep],
        values,
        region,
        width=width,
    )
    rgba = reflectivity_rgba(grid)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp")
    try:
        Image.fromarray(rgba, mode="RGBA").save(temporary, format="PNG", optimize=True)
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()

    metadata = NexradRadarMetadata(
        field_name=field_name,
        sweep_count=int(radar.nsweeps),
        radar_latitude=float(np.asarray(radar.latitude["data"]).ravel()[0]),
        radar_longitude=float(np.asarray(radar.longitude["data"]).ravel()[0]),
        elevation_degrees=float(np.ma.median(radar.elevation["data"][lowest_sweep])),
    )
    return RenderedRaster(region, grid.shape[1], grid.shape[0]), metadata
