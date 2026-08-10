from __future__ import annotations

"""Colour and crop ERA5 hourly precipitation fields.

ERA5 is a gridded reanalysis, not a radar observation.  The renderer keeps
the source grid intact and uses hourly total precipitation as the intensity
dimension for both products.  It deliberately does not convert the fields to
dBZ or interpolate them into five-minute frames.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from .config import RegionBounds
from .rendering import RenderedRaster


ERA5_NATIVE_RESOLUTION = "0.25° × 0.25° regular latitude/longitude grid"

# ECMWF code table 4.201 values used by the ERA5 precipitation_type field.
# Reference: https://confluence.ecmwf.int/pages/viewpage.action?pageId=179741903
# 0 is no precipitation; the renderer treats unknown values as transparent
# rather than inventing a phase classification.
ERA5_PTYPE_CATEGORIES: dict[int, str] = {
    0: "none",
    1: "rain",
    3: "freezing-rain",
    5: "snow",
    6: "wet-snow",
    7: "mixed-rain-snow",
    8: "ice-pellets",
}

# Hourly total precipitation is supplied by CDS in metres of water equivalent.
# These stops are mm/hour and are intentionally independent from the MRMS dBZ
# palette.  The first stop is weak but visible; values below it are transparent.
ERA5_PRECIPITATION_STOPS = np.asarray([0.01, 0.10, 1.0, 5.0, 10.0, 25.0], dtype=np.float32)
ERA5_TOTAL_PRECIPITATION_COLORS = np.asarray(
    [
        [74, 183, 232, 145],
        [37, 211, 191, 175],
        [43, 190, 92, 205],
        [246, 224, 54, 225],
        [255, 137, 31, 242],
        [225, 43, 54, 252],
    ],
    dtype=np.uint8,
)

# Phase families follow the product brief: rain green→yellow→orange→red,
# snow cyan→blue, freezing rain pink→magenta, mixed purple, and a distinct
# ochre/gold ice-pellet family.
ERA5_PHASE_COLORS: dict[str, np.ndarray] = {
    "rain": np.asarray(
        [[31, 164, 87, 155], [107, 211, 55, 180], [245, 222, 45, 210], [255, 136, 29, 235], [224, 42, 51, 252]],
        dtype=np.uint8,
    ),
    "snow": np.asarray(
        [[91, 224, 220, 155], [61, 201, 237, 180], [55, 157, 233, 210], [50, 104, 218, 235], [42, 51, 157, 252]],
        dtype=np.uint8,
    ),
    "freezing-rain": np.asarray(
        [[255, 174, 224, 160], [255, 112, 205, 185], [235, 54, 175, 215], [189, 41, 157, 238], [119, 27, 121, 252]],
        dtype=np.uint8,
    ),
    "mixed-rain-snow": np.asarray(
        [[219, 191, 255, 160], [191, 135, 237, 185], [156, 82, 205, 215], [111, 47, 169, 238], [74, 29, 121, 252]],
        dtype=np.uint8,
    ),
    "ice-pellets": np.asarray(
        [[233, 224, 142, 165], [216, 192, 83, 190], [183, 145, 44, 215], [142, 95, 30, 238], [94, 57, 25, 252]],
        dtype=np.uint8,
    ),
}


@dataclass(frozen=True)
class Era5RenderedFrame:
    phase: RenderedRaster
    total_precipitation: RenderedRaster


def precipitation_type_category(code: int | float) -> str:
    """Return the documented ECMWF PTYPE category or ``unknown``."""

    try:
        normalized = int(round(float(code)))
    except (TypeError, ValueError):
        return "unknown"
    return ERA5_PTYPE_CATEGORIES.get(normalized, "unknown")


def precipitation_rate_mm_per_hour(total_precipitation_m: np.ndarray | float) -> np.ndarray:
    """Convert an hourly ERA5 total-precipitation accumulation to mm/hour."""

    values = np.asarray(total_precipitation_m, dtype=np.float32)
    converted = np.where(np.isfinite(values), np.maximum(values, 0.0) * 1000.0, np.nan)
    return converted.astype(np.float32, copy=False)


def _palette_for_scalar(values: np.ndarray, colors: np.ndarray) -> np.ndarray:
    indices = np.clip(
        np.searchsorted(ERA5_PRECIPITATION_STOPS, values, side="right") - 1,
        0,
        len(colors) - 1,
    )
    rgba = colors[indices].copy()
    rgba[~np.isfinite(values) | (values < ERA5_PRECIPITATION_STOPS[0])] = [0, 0, 0, 0]
    return rgba


def total_precipitation_rgba(total_precipitation_m: np.ndarray) -> np.ndarray:
    """Render hourly total precipitation using a mm/hour palette."""

    return _palette_for_scalar(
        precipitation_rate_mm_per_hour(total_precipitation_m),
        ERA5_TOTAL_PRECIPITATION_COLORS,
    )


def precipitation_phase_rgba(
    precipitation_type: np.ndarray,
    total_precipitation_m: np.ndarray,
) -> np.ndarray:
    """Render phase classes with opacity/colour intensity from hourly TP."""

    ptype = np.rint(np.asarray(precipitation_type, dtype=np.float32)).astype(np.int16)
    rate = precipitation_rate_mm_per_hour(total_precipitation_m)
    rgba = np.zeros((*rate.shape, 4), dtype=np.uint8)
    intensity = np.clip(
        np.searchsorted(ERA5_PRECIPITATION_STOPS, rate, side="right") - 1,
        0,
        len(ERA5_PRECIPITATION_STOPS) - 1,
    )

    category_by_code = {code: category for code, category in ERA5_PTYPE_CATEGORIES.items() if category != "none"}
    for code, category in category_by_code.items():
        if category == "wet-snow":
            palette_category = "snow"
        else:
            palette_category = category
        palette = ERA5_PHASE_COLORS[palette_category]
        mask = (ptype == code) & np.isfinite(rate) & (rate >= ERA5_PRECIPITATION_STOPS[0])
        # The shared precipitation stops have six bins while each phase
        # family intentionally has five colour stops.  Saturate very heavy
        # precipitation at the strongest phase colour instead of indexing
        # past the palette.
        palette_intensity = np.minimum(intensity, len(palette) - 1)
        rgba[mask] = palette[palette_intensity[mask]]
    return rgba


def _normalize_longitudes(longitudes: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    normalized = np.where(longitudes > 180.0, longitudes - 360.0, longitudes)
    order = np.argsort(normalized)
    return normalized[order], values[..., order]


def crop_era5_grid(
    values: np.ndarray,
    latitudes: np.ndarray,
    longitudes: np.ndarray,
    region: RegionBounds,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, RegionBounds]:
    """Crop a regular ERA5 grid without resampling its native cells."""

    grid = np.asarray(values)
    lats = np.asarray(latitudes, dtype=np.float64)
    lons = np.asarray(longitudes, dtype=np.float64)
    if grid.ndim != 2 or lats.ndim != 1 or lons.ndim != 1:
        raise ValueError(f"ERA5 grid must be 2-D with 1-D coordinates, received {grid.shape}")
    if grid.shape != (len(lats), len(lons)):
        raise ValueError(f"ERA5 grid shape {grid.shape} does not match coordinates {(len(lats), len(lons))}")

    lons, grid = _normalize_longitudes(lons, grid)
    lon_mask = (lons >= region.west) & (lons <= region.east)
    lat_mask = (lats >= region.south) & (lats <= region.north)
    if not np.any(lon_mask) or not np.any(lat_mask):
        raise ValueError("ERA5 grid has no cells inside the requested bounds")
    cropped = grid[np.ix_(lat_mask, lon_mask)]
    selected_lats = lats[lat_mask]
    selected_lons = lons[lon_mask]
    if selected_lats[0] < selected_lats[-1]:
        cropped = cropped[::-1, :]
        selected_lats = selected_lats[::-1]

    lat_step = abs(float(np.median(np.diff(selected_lats)))) if len(selected_lats) > 1 else 0.125
    lon_step = abs(float(np.median(np.diff(selected_lons)))) if len(selected_lons) > 1 else 0.125
    actual = RegionBounds(
        west=max(-180.0, float(selected_lons[0] - lon_step / 2.0)),
        east=min(180.0, float(selected_lons[-1] + lon_step / 2.0)),
        south=max(-90.0, float(selected_lats[-1] - lat_step / 2.0)),
        north=min(90.0, float(selected_lats[0] + lat_step / 2.0)),
    )
    return cropped, selected_lats, selected_lons, actual


def _save_rgba(rgba: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp")
    try:
        Image.fromarray(rgba, mode="RGBA").save(temporary, format="PNG", optimize=True)
        temporary.replace(output_path)
    finally:
        if temporary.exists():
            temporary.unlink()


def render_era5_frame(
    precipitation_type: np.ndarray,
    total_precipitation_m: np.ndarray,
    latitudes: np.ndarray,
    longitudes: np.ndarray,
    *,
    region: RegionBounds,
    phase_output_path: Path,
    total_output_path: Path,
) -> Era5RenderedFrame:
    """Crop and render one exact hourly ERA5 frame."""

    phase_values, selected_lats, selected_lons, bounds = crop_era5_grid(
        precipitation_type,
        latitudes,
        longitudes,
        region,
    )
    total_values, total_lats, total_lons, total_bounds = crop_era5_grid(
        total_precipitation_m,
        latitudes,
        longitudes,
        region,
    )
    if phase_values.shape != total_values.shape or not np.allclose(selected_lats, total_lats) or not np.allclose(selected_lons, total_lons):
        raise ValueError("ERA5 precipitation type and total precipitation grids are not aligned")

    _save_rgba(precipitation_phase_rgba(phase_values, total_values), phase_output_path)
    _save_rgba(total_precipitation_rgba(total_values), total_output_path)
    rendered = RenderedRaster(bounds, phase_values.shape[1], phase_values.shape[0])
    return Era5RenderedFrame(rendered, RenderedRaster(total_bounds, total_values.shape[1], total_values.shape[0]))


def palette_color_for_tests(product: str, ptype: int, precipitation_mm_per_hour: float) -> tuple[int, int, int, int]:
    """Expose a small deterministic palette seam for unit tests."""

    if product == "phase":
        rgba = precipitation_phase_rgba(
            np.asarray([[ptype]], dtype=np.float32),
            np.asarray([[precipitation_mm_per_hour / 1000.0]], dtype=np.float32),
        )
    elif product == "total":
        rgba = total_precipitation_rgba(
            np.asarray([[precipitation_mm_per_hour / 1000.0]], dtype=np.float32),
        )
    else:
        raise ValueError(f"Unsupported ERA5 test palette {product!r}")
    return tuple(int(channel) for channel in rgba[0, 0])
