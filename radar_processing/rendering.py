from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import numpy as np
import xarray as xr
from PIL import Image

from .config import RegionBounds


# Two-dBZ bins preserve the native MRMS texture while the anchor colors keep the
# palette maintainable and original to Wall Cloud. Weak returns are neutral so
# they remain legible without competing with operationally significant echoes.
REFLECTIVITY_STOPS = np.arange(5, 73, 2, dtype=np.float32)
REFLECTIVITY_ANCHOR_VALUES = np.array(
    [5, 9, 13, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 72],
    dtype=np.float32,
)
REFLECTIVITY_ANCHOR_COLORS = np.array(
    [
        [194, 200, 199, 82],
        [143, 152, 149, 112],
        [86, 98, 94, 148],
        [25, 112, 70, 182],
        [0, 184, 76, 226],
        [20, 225, 67, 236],
        [116, 226, 35, 241],
        [225, 228, 28, 246],
        [255, 191, 29, 249],
        [255, 116, 30, 251],
        [239, 47, 43, 253],
        [188, 29, 67, 254],
        [222, 49, 164, 255],
        [145, 55, 190, 255],
        [205, 120, 232, 255],
        [247, 222, 255, 255],
    ],
    dtype=np.float32,
)


def _interpolated_reflectivity_colors() -> np.ndarray:
    channels = [
        np.interp(REFLECTIVITY_STOPS, REFLECTIVITY_ANCHOR_VALUES, REFLECTIVITY_ANCHOR_COLORS[:, channel])
        for channel in range(4)
    ]
    return np.rint(np.stack(channels, axis=1)).astype(np.uint8)


REFLECTIVITY_COLORS = _interpolated_reflectivity_colors()
PRECIP_INTENSITY_STOPS = np.array([5, 20, 35, 50, 60], dtype=np.float32)
RAIN_COLORS = np.array(
    [
        [24, 112, 69, 178],
        [0, 195, 76, 228],
        [239, 221, 35, 242],
        [242, 68, 42, 250],
        [196, 41, 151, 255],
    ],
    dtype=np.uint8,
)
SNOW_COLORS = np.array(
    [
        [196, 246, 242, 178],
        [122, 220, 239, 196],
        [68, 171, 240, 216],
        [51, 102, 226, 232],
        [31, 55, 158, 248],
    ],
    dtype=np.uint8,
)
MIXED_COLORS = np.array(
    [
        [255, 214, 240, 178],
        [255, 157, 213, 198],
        [232, 82, 177, 220],
        [164, 56, 170, 238],
        [95, 41, 147, 252],
    ],
    dtype=np.uint8,
)

PRECIP_FLAG_CATEGORIES: dict[int, str] = {
    0: "none",
    1: "rain",
    3: "snow",
    6: "convection",
    7: "hail",
    10: "cool",
    91: "rain",
    96: "convection",
}


@dataclass(frozen=True)
class RenderedRaster:
    bounds: RegionBounds
    width: int
    height: int

    def manifest_bounds(self) -> list[float]:
        return self.bounds.as_list()


def precip_category(flag: int | float) -> str:
    try:
        code = int(round(float(flag)))
    except (TypeError, ValueError):
        return "unknown"
    return PRECIP_FLAG_CATEGORIES.get(code, "unknown")


def _variable_name(dataset: xr.Dataset) -> str:
    if not dataset.data_vars:
        raise ValueError("MRMS GRIB2 dataset contains no data variable")
    return next(iter(dataset.data_vars))


def _crop_dataset(path: Path, region: RegionBounds) -> tuple[np.ndarray, RegionBounds]:
    with xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""}) as dataset:
        variable = dataset[_variable_name(dataset)]
        west = region.west if region.west >= 0 else region.west + 360
        east = region.east if region.east >= 0 else region.east + 360
        cropped = variable.sel(
            latitude=slice(region.north, region.south),
            longitude=slice(west, east),
        )
        values = np.asarray(cropped.values, dtype=np.float32)
        latitudes = np.asarray(cropped.latitude.values, dtype=np.float64)
        longitudes = np.asarray(cropped.longitude.values, dtype=np.float64)

    if values.ndim != 2 or not latitudes.size or not longitudes.size:
        raise ValueError(f"MRMS crop has unexpected shape: {values.shape}")

    lat_step = abs(float(latitudes[1] - latitudes[0])) if len(latitudes) > 1 else 0.01
    lon_step = abs(float(longitudes[1] - longitudes[0])) if len(longitudes) > 1 else 0.01
    actual_bounds = RegionBounds(
        west=float(longitudes[0] - lon_step / 2),
        east=float(longitudes[-1] + lon_step / 2),
        south=float(latitudes[-1] - lat_step / 2),
        north=float(latitudes[0] + lat_step / 2),
    )
    normalized_bounds = RegionBounds(
        west=actual_bounds.west if actual_bounds.west <= 180 else actual_bounds.west - 360,
        east=actual_bounds.east if actual_bounds.east <= 180 else actual_bounds.east - 360,
        south=actual_bounds.south,
        north=actual_bounds.north,
    )
    return values, normalized_bounds


def _palette_for_reflectivity(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    indices = np.searchsorted(REFLECTIVITY_STOPS, values, side="right") - 1
    indices = np.clip(indices, 0, len(REFLECTIVITY_COLORS) - 1)
    rgba = REFLECTIVITY_COLORS[indices].copy()
    valid = np.isfinite(values) & (values >= REFLECTIVITY_STOPS[0])
    rgba[~valid] = [0, 0, 0, 0]
    return rgba


def _palette_for_precip_type(reflectivity: np.ndarray, flags: np.ndarray) -> np.ndarray:
    reflectivity = np.asarray(reflectivity, dtype=np.float32)
    flags = np.asarray(flags, dtype=np.float32)
    intensity = np.clip(np.digitize(reflectivity, PRECIP_INTENSITY_STOPS, right=False) - 1, 0, 4)
    rgba = np.zeros((*reflectivity.shape, 4), dtype=np.uint8)
    categories = np.rint(flags).astype(np.int16)

    rain = np.isin(categories, [1, 6, 91, 96])
    snow = categories == 3
    mixed = np.isin(categories, [7, 10])
    rgba[rain] = RAIN_COLORS[intensity[rain]]
    rgba[snow] = SNOW_COLORS[intensity[snow]]
    rgba[mixed] = MIXED_COLORS[intensity[mixed]]

    known = np.isin(categories, list(PRECIP_FLAG_CATEGORIES))
    fallback = (~known) & np.isfinite(reflectivity) & (reflectivity >= REFLECTIVITY_STOPS[0])
    if fallback.any():
        rgba[fallback] = _palette_for_reflectivity(reflectivity[fallback])
    rgba[(categories == 0) | ~np.isfinite(reflectivity) | (reflectivity < REFLECTIVITY_STOPS[0])] = [0, 0, 0, 0]
    return rgba


def _save_rgba(rgba: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray(rgba, mode="RGBA")
    image.save(output_path, format="PNG", optimize=True)


def render_reflectivity(input_path: Path, output_path: Path, region: RegionBounds) -> RenderedRaster:
    values, actual_bounds = _crop_dataset(input_path, region)
    _save_rgba(_palette_for_reflectivity(values), output_path)
    return RenderedRaster(actual_bounds, values.shape[1], values.shape[0])


def render_precip_type(
    reflectivity_path: Path,
    precip_flag_path: Path,
    output_path: Path,
    region: RegionBounds,
) -> RenderedRaster:
    reflectivity, actual_bounds = _crop_dataset(reflectivity_path, region)
    flags, flag_bounds = _crop_dataset(precip_flag_path, region)
    if reflectivity.shape != flags.shape:
        raise ValueError(
            f"MRMS reflectivity/PrecipFlag crop shapes differ: {reflectivity.shape} vs {flags.shape}"
        )
    if abs(actual_bounds.west - flag_bounds.west) > 0.02 or abs(actual_bounds.north - flag_bounds.north) > 0.02:
        raise ValueError("MRMS reflectivity/PrecipFlag crop grids are not aligned")
    _save_rgba(_palette_for_precip_type(reflectivity, flags), output_path)
    return RenderedRaster(actual_bounds, reflectivity.shape[1], reflectivity.shape[0])


def palette_category_for_tests(flag: int | float) -> str:
    """Small named wrapper used by unit tests and future processors."""

    return precip_category(flag)
