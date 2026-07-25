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


NEXRAD_PRODUCT_DEFINITIONS: dict[str, dict[str, Any]] = {
    "NEXRADLevel2BaseReflectivity": {
        "label": "Base Reflectivity",
        "unit": "dBZ",
        "fields": ("reflectivity", "REF", "reflectivity_horizontal"),
        "minimum": -20.0,
        "maximum": 100.0,
    },
    "NEXRADLevel2Velocity": {
        "label": "Radial Velocity",
        "unit": "m/s",
        "fields": ("velocity", "VEL", "radial_velocity"),
        "minimum": -150.0,
        "maximum": 150.0,
    },
    "NEXRADLevel2CorrelationCoefficient": {
        "label": "Correlation Coefficient (ρhv)",
        "unit": "ρhv",
        "fields": ("cross_correlation_ratio", "RHOHV", "cross_correlation_coefficient", "rhohv"),
        "minimum": 0.0,
        "maximum": 1.1,
    },
}


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


def grid_level2_values(
    gate_longitude: np.ndarray,
    gate_latitude: np.ndarray,
    values: np.ndarray | np.ma.MaskedArray[Any, Any],
    region: RegionBounds,
    *,
    width: int,
    minimum: float,
    maximum: float,
) -> np.ndarray:
    """Project polar radar gates onto a Web-Mercator-aligned max-value grid."""

    height = raster_height(region, width)
    values = np.asarray(np.ma.filled(values, np.nan), dtype=np.float32)
    longitudes = np.asarray(gate_longitude, dtype=np.float64)
    latitudes = np.asarray(gate_latitude, dtype=np.float64)
    if values.shape != longitudes.shape or values.shape != latitudes.shape:
        raise ValueError("NEXRAD reflectivity and gate-coordinate arrays do not share one shape")

    valid = (
        np.isfinite(values)
        & np.isfinite(longitudes)
        & np.isfinite(latitudes)
        & (values >= minimum)
        & (values <= maximum)
        & (longitudes >= region.west)
        & (longitudes <= region.east)
        & (latitudes >= region.south)
        & (latitudes <= region.north)
    )
    if not np.any(valid):
        raise ValueError("The KRAX volume contains no supported gates inside the configured region")

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


def grid_reflectivity(
    gate_longitude: np.ndarray,
    gate_latitude: np.ndarray,
    reflectivity: np.ndarray | np.ma.MaskedArray[Any, Any],
    region: RegionBounds,
    *,
    width: int,
) -> np.ndarray:
    """Backward-compatible base-reflectivity grid helper."""

    return grid_level2_values(
        gate_longitude,
        gate_latitude,
        reflectivity,
        region,
        width=width,
        minimum=-20.0,
        maximum=100.0,
    )


def _field_name(radar: Any, product_id: str) -> str:
    try:
        aliases = NEXRAD_PRODUCT_DEFINITIONS[product_id]["fields"]
    except KeyError as exc:
        raise ValueError(f"Unsupported KRAX Level II product: {product_id}") from exc
    for name in aliases:
        if name in radar.fields:
            return name
    available = ", ".join(sorted(radar.fields))
    label = NEXRAD_PRODUCT_DEFINITIONS[product_id]["label"]
    raise ValueError(f"KRAX volume has no {label} field; available fields: {available}")


def _first_supported_sweep(radar: Any, field_name: str, region: RegionBounds, minimum: float, maximum: float):
    """Use the lowest sweep that actually carries this Level II field."""

    for sweep_index in range(int(radar.nsweeps)):
        sweep = radar.get_slice(sweep_index)
        values = np.asarray(np.ma.filled(radar.fields[field_name]["data"][sweep], np.nan), dtype=np.float32)
        longitudes = np.asarray(radar.gate_longitude["data"][sweep], dtype=np.float64)
        latitudes = np.asarray(radar.gate_latitude["data"][sweep], dtype=np.float64)
        supported = (
            np.isfinite(values)
            & (values >= minimum)
            & (values <= maximum)
            & (longitudes >= region.west)
            & (longitudes <= region.east)
            & (latitudes >= region.south)
            & (latitudes <= region.north)
        )
        if np.any(supported):
            return sweep
    raise ValueError(f"The KRAX volume contains no supported {field_name} gates inside the configured region")


def _level2_rgba(product_id: str, values: np.ndarray) -> np.ndarray:
    if product_id == "NEXRADLevel2BaseReflectivity":
        return reflectivity_rgba(values)
    if product_id == "NEXRADLevel2Velocity":
        values = np.asarray(values, dtype=np.float32)
        rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
        stops = np.asarray([-50, -25, -5, 5, 25, 50], dtype=np.float32)
        colors = np.asarray([
            [69, 117, 180, 230], [145, 191, 219, 230], [247, 247, 247, 185],
            [247, 247, 247, 185], [252, 141, 89, 230], [215, 48, 39, 245],
        ], dtype=np.uint8)
        indices = np.clip(np.searchsorted(stops, values, side="right") - 1, 0, len(colors) - 1)
        rgba[:] = colors[indices]
        rgba[~np.isfinite(values)] = [0, 0, 0, 0]
        return rgba
    if product_id == "NEXRADLevel2CorrelationCoefficient":
        values = np.asarray(values, dtype=np.float32)
        stops = np.asarray([0.8, 0.9, 0.95, 0.98, 1.0], dtype=np.float32)
        colors = np.asarray([
            [243, 245, 244, 95], [213, 238, 231, 145], [145, 212, 199, 185],
            [53, 167, 161, 220], [10, 119, 123, 245],
        ], dtype=np.uint8)
        indices = np.clip(np.searchsorted(stops, values, side="right") - 1, 0, len(colors) - 1)
        rgba = colors[indices].copy()
        rgba[~np.isfinite(values) | (values < stops[0])] = [0, 0, 0, 0]
        return rgba
    raise ValueError(f"Unsupported KRAX Level II product: {product_id}")


def render_level2_product(
    input_path: Path,
    output_path: Path,
    region: RegionBounds,
    *,
    product_id: str = "NEXRADLevel2BaseReflectivity",
    width: int = 1200,
) -> tuple[RenderedRaster, NexradRadarMetadata]:
    """Decode a NEXRAD Archive II volume and render one supported Level II field."""

    try:
        import pyart
    except ImportError as exc:  # pragma: no cover - exercised by deployment smoke tests
        raise RuntimeError("Py-ART is required; install requirements-nexrad.txt") from exc

    radar = pyart.io.read_nexrad_archive(str(input_path), delay_field_loading=False)
    definition = NEXRAD_PRODUCT_DEFINITIONS.get(product_id)
    if definition is None:
        raise ValueError(f"Unsupported KRAX Level II product: {product_id}")
    field_name = _field_name(radar, product_id)
    radar.init_gate_longitude_latitude()
    sweep = _first_supported_sweep(
        radar,
        field_name,
        region,
        float(definition["minimum"]),
        float(definition["maximum"]),
    )
    values = radar.fields[field_name]["data"][sweep]
    grid = grid_level2_values(
        radar.gate_longitude["data"][sweep],
        radar.gate_latitude["data"][sweep],
        values,
        region,
        width=width,
        minimum=float(definition["minimum"]),
        maximum=float(definition["maximum"]),
    )
    rgba = _level2_rgba(product_id, grid)
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
        elevation_degrees=float(np.ma.median(radar.elevation["data"][sweep])),
    )
    return RenderedRaster(region, grid.shape[1], grid.shape[0]), metadata


def render_level2_reflectivity(
    input_path: Path,
    output_path: Path,
    region: RegionBounds,
    *,
    width: int = 1200,
) -> tuple[RenderedRaster, NexradRadarMetadata]:
    """Backward-compatible base-reflectivity entry point."""

    return render_level2_product(
        input_path,
        output_path,
        region,
        product_id="NEXRADLevel2BaseReflectivity",
        width=width,
    )
