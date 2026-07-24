from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .config import ProcessingConfig, RegionBounds
from .mrms import request_bytes
from .rendering import (
    ANALYSIS_PALETTES,
    MIXED_COLORS,
    RAIN_COLORS,
    REFLECTIVITY_COLORS,
    REFLECTIVITY_STOPS,
    SNOW_COLORS,
)


LOGGER = logging.getLogger("wallcloud.radar.animation")
CENSUS_GEOGRAPHY_BASE = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "Generalized_ACS2024/State_County/MapServer"
)
EASTERN = ZoneInfo("America/New_York")
OCEAN_COLOR = (229, 237, 245, 255)
LAND_COLOR = (247, 248, 247, 255)
GRID_COLOR = (177, 188, 198, 150)
COUNTY_COLOR = (143, 153, 162, 205)
STATE_COLOR = (36, 44, 51, 255)
BRAND_NAVY = (16, 42, 67, 255)
BRAND_TEAL = (129, 222, 208, 255)
BRAND_LIGHT = (237, 245, 243, 255)
FRAME_BORDER = (36, 55, 69, 255)

CITIES = (
    ("Raleigh", -78.6382, 35.7796, True),
    ("Durham", -78.8986, 36.0001, True),
    ("Charlotte", -80.8431, 35.2271, True),
    ("Greensboro", -79.7910, 36.0726, True),
    ("Winston-Salem", -80.2442, 36.0999, True),
    ("Fayetteville", -78.8784, 35.0527, True),
    ("Wilmington", -77.9447, 34.2257, True),
    ("Asheville", -82.5515, 35.5951, True),
    ("Greenville", -77.3664, 35.6127, False),
    ("Rocky Mount", -77.7905, 35.9382, False),
    ("New Bern", -77.0447, 35.1085, False),
    ("Richmond", -77.4360, 37.5407, False),
    ("Knoxville", -83.9207, 35.9606, False),
    ("Columbia", -81.0348, 34.0007, False),
)


def _crop_radar_to_bounds(radar: Image.Image, source_bounds: RegionBounds, target_bounds: RegionBounds) -> Image.Image:
    """Crop a rendered regional raster to the branded-loop view."""

    if (
        source_bounds.east <= source_bounds.west
        or source_bounds.north <= source_bounds.south
        or target_bounds.east <= source_bounds.west
        or target_bounds.west >= source_bounds.east
        or target_bounds.north <= source_bounds.south
        or target_bounds.south >= source_bounds.north
    ):
        return radar.copy()

    west = max(source_bounds.west, target_bounds.west)
    east = min(source_bounds.east, target_bounds.east)
    south = max(source_bounds.south, target_bounds.south)
    north = min(source_bounds.north, target_bounds.north)
    left = max(0, min(radar.width - 1, round((west - source_bounds.west) / (source_bounds.east - source_bounds.west) * radar.width)))
    right = max(left + 1, min(radar.width, round((east - source_bounds.west) / (source_bounds.east - source_bounds.west) * radar.width)))
    top = max(0, min(radar.height - 1, round((source_bounds.north - north) / (source_bounds.north - source_bounds.south) * radar.height)))
    bottom = max(top + 1, min(radar.height, round((source_bounds.north - south) / (source_bounds.north - source_bounds.south) * radar.height)))
    return radar.crop((left, top, right, bottom))


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ("DejaVuSans-Bold.ttf", "Arial Bold.ttf") if bold else ("DejaVuSans.ttf", "Arial.ttf")
    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _census_url(layer: int, region: RegionBounds, out_fields: str) -> str:
    params = urlencode(
        {
            "where": "1=1",
            "geometry": ",".join(str(value) for value in region.as_list()),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
    )
    return f"{CENSUS_GEOGRAPHY_BASE}/{layer}/query?{params}"


def fetch_export_geography(config: ProcessingConfig) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch official generalized boundaries used only to decorate downloadable GIFs."""

    states = json.loads(request_bytes(_census_url(7, config.region, "NAME,STATE"), config))
    counties = json.loads(request_bytes(_census_url(12, config.region, "NAME,STATE,COUNTY"), config))
    return states, counties


def _project(position: Iterable[float], bounds: RegionBounds, width: int, height: int) -> tuple[int, int]:
    longitude, latitude = list(position)[:2]
    x = (float(longitude) - bounds.west) / (bounds.east - bounds.west) * width
    y = (bounds.north - float(latitude)) / (bounds.north - bounds.south) * height
    return round(x), round(y)


def _polygon_groups(geometry: dict[str, Any]) -> list[list[list[list[float]]]]:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        return [coordinates]
    if geometry.get("type") == "MultiPolygon":
        return coordinates
    return []


def _draw_geography(
    draw: ImageDraw.ImageDraw,
    feature_collection: dict[str, Any],
    bounds: RegionBounds,
    width: int,
    height: int,
    *,
    fill: tuple[int, int, int, int] | None,
    line: tuple[int, int, int, int],
    line_width: int,
) -> None:
    for feature in feature_collection.get("features", []):
        geometry = feature.get("geometry") or {}
        for polygon in _polygon_groups(geometry):
            for ring_index, ring in enumerate(polygon):
                points = [_project(position, bounds, width, height) for position in ring]
                if len(points) < 2:
                    continue
                if fill is not None and ring_index == 0:
                    draw.polygon(points, fill=fill)
                elif fill is not None and ring_index > 0:
                    draw.polygon(points, fill=OCEAN_COLOR)
                draw.line(points, fill=line, width=line_width, joint="curve")


def _draw_dashed_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    *,
    dash: int = 3,
    gap: int = 5,
) -> None:
    x1, y1 = start
    x2, y2 = end
    length = max(abs(x2 - x1), abs(y2 - y1))
    if not length:
        return
    for offset in range(0, length, dash + gap):
        ratio_start = offset / length
        ratio_end = min(offset + dash, length) / length
        segment_start = (round(x1 + (x2 - x1) * ratio_start), round(y1 + (y2 - y1) * ratio_start))
        segment_end = (round(x1 + (x2 - x1) * ratio_end), round(y1 + (y2 - y1) * ratio_end))
        draw.line((segment_start, segment_end), fill=GRID_COLOR, width=1)


def _map_base(
    bounds: RegionBounds,
    width: int,
    height: int,
    states: dict[str, Any] | None,
) -> Image.Image:
    image = Image.new("RGBA", (width, height), OCEAN_COLOR)
    draw = ImageDraw.Draw(image, "RGBA")
    if states:
        _draw_geography(
            draw,
            states,
            bounds,
            width,
            height,
            fill=LAND_COLOR,
            line=STATE_COLOR,
            line_width=1,
        )
    for longitude in range(round(bounds.west) + 1, round(bounds.east) + 1):
        x, _ = _project((longitude, bounds.south), bounds, width, height)
        _draw_dashed_line(draw, (x, 0), (x, height))
    for latitude in range(round(bounds.south) + 1, round(bounds.north) + 1):
        _, y = _project((bounds.west, latitude), bounds, width, height)
        _draw_dashed_line(draw, (0, y), (width, y))
    return image


def _draw_city_labels(draw: ImageDraw.ImageDraw, bounds: RegionBounds, width: int, height: int) -> None:
    occupied: list[tuple[int, int, int, int]] = []
    for label, longitude, latitude, primary in CITIES:
        if not (bounds.west <= longitude <= bounds.east and bounds.south <= latitude <= bounds.north):
            continue
        font = _font(12 if primary else 9, bold=primary)
        x, y = _project((longitude, latitude), bounds, width, height)
        dot_radius = 3 if primary else 2
        dot_color = (26, 34, 39, 255) if primary else (83, 97, 106, 255)
        text_color = (20, 27, 32, 255) if primary else (83, 97, 106, 255)
        stroke_width = 2 if primary else 1
        draw.ellipse((x - dot_radius, y - dot_radius, x + dot_radius, y + dot_radius), fill=dot_color)
        text_box = draw.textbbox((0, 0), label, font=font, stroke_width=stroke_width)
        label_width = text_box[2] - text_box[0]
        label_height = text_box[3] - text_box[1]
        candidates = ((5, -label_height - 3), (5, 5), (-label_width - 5, -label_height - 3), (-label_width - 5, 5))
        for offset_x, offset_y in candidates:
            box = (x + offset_x, y + offset_y, x + offset_x + label_width, y + offset_y + label_height)
            if box[0] < 2 or box[1] < 2 or box[2] >= width - 2 or box[3] >= height - 2:
                continue
            if any(box[0] - 3 < other[2] and box[2] + 3 > other[0] and box[1] - 3 < other[3] and box[3] + 3 > other[1] for other in occupied):
                continue
            draw.text(
                (x + offset_x, y + offset_y),
                label,
                font=font,
                fill=text_color,
                stroke_width=stroke_width,
                stroke_fill=(255, 255, 255, 235),
            )
            occupied.append(box)
            break


def _format_valid_time(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(EASTERN)
    clock = parsed.strftime("%I:%M %p").lstrip("0")
    return f"{clock} ET · {parsed:%a %b %d, %Y}"


def _format_loop_period(first_value: str, last_value: str) -> str:
    first = datetime.fromisoformat(first_value.replace("Z", "+00:00")).astimezone(EASTERN)
    last = datetime.fromisoformat(last_value.replace("Z", "+00:00")).astimezone(EASTERN)

    def clock(value: datetime, *, include_period: bool = True) -> str:
        rendered = value.strftime("%I:%M %p").lstrip("0")
        return rendered if include_period else rendered.rsplit(" ", 1)[0]

    if first == last:
        return f"{clock(last)} ET"
    if first.date() == last.date():
        same_period = first.strftime("%p") == last.strftime("%p")
        return f"{clock(first, include_period=not same_period)}–{clock(last)} ET"
    return f"{first:%b %d} {clock(first)}–{last:%b %d} {clock(last)} ET"


def _reflectivity_legend_entries() -> list[tuple[str, tuple[int, int, int, int]]]:
    values = np.array([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70], dtype=np.float32)
    indices = np.clip(np.searchsorted(REFLECTIVITY_STOPS, values, side="right") - 1, 0, len(REFLECTIVITY_COLORS) - 1)
    colors = REFLECTIVITY_COLORS[indices]
    return [
        (
            "70+" if index == len(values) - 1 else str(int(value)),
            tuple(int(channel) for channel in colors[index][:3]) + (255,),
        )
        for index, value in reversed(list(enumerate(values)))
    ]


def _vertical_legend_entries(
    product_id: str,
) -> tuple[str, list[tuple[str, tuple[int, int, int, int]]], bool]:
    if product_id == "PrecipFlag":
        return (
            "TYPE",
            [
                ("Rain", tuple(int(channel) for channel in RAIN_COLORS[2][:3]) + (255,)),
                ("Snow", tuple(int(channel) for channel in SNOW_COLORS[2][:3]) + (255,)),
                ("Mixed / hail", tuple(int(channel) for channel in MIXED_COLORS[2][:3]) + (255,)),
            ],
            True,
        )
    if product_id == "MultiSensor_QPE_01H_Pass1":
        stops, colors = ANALYSIS_PALETTES[product_id]
        entries = [
            (
                "50+" if index == len(stops) - 1 else f"{float(value):g}",
                tuple(int(channel) for channel in colors[index][:3]) + (255,),
            )
            for index, value in reversed(list(enumerate(stops)))
        ]
        return "mm", entries, False
    return "dBZ", _reflectivity_legend_entries(), False


def _draw_vertical_legend(
    image: Image.Image,
    map_x: int,
    map_y: int,
    map_width: int,
    map_height: int,
    product_id: str,
    unit_label: str,
) -> None:
    _default_heading, entries, categorical = _vertical_legend_entries(product_id)
    heading = unit_label
    compact = len(entries) > 8
    panel_width = 58 if compact else 104
    row_height = 14 if compact else 36
    panel_height = 28 + len(entries) * row_height + 6
    panel_x = map_x + map_width - panel_width - 10
    panel_y = map_y + map_height - panel_height - 10
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay, "RGBA")
    overlay_draw.rectangle(
        (panel_x, panel_y, panel_x + panel_width, panel_y + panel_height),
        fill=(255, 255, 255, 128),
        outline=(16, 42, 67, 190),
        width=1,
    )
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image, "RGBA")
    heading_font = _font(8, bold=True)
    heading_box = draw.textbbox((0, 0), heading, font=heading_font)
    heading_width = heading_box[2] - heading_box[0]
    draw.text(
        (panel_x + (panel_width - heading_width) // 2, panel_y + 8),
        heading,
        font=heading_font,
        fill=BRAND_NAVY,
    )
    label_font = _font(9 if categorical else 8, bold=True)
    for index, (label, color) in enumerate(entries):
        row_y = panel_y + 26 + index * row_height
        swatch_left = panel_x + 7
        swatch_width = 11 if compact else 16
        draw.rectangle((swatch_left, row_y, swatch_left + swatch_width, row_y + row_height), fill=color)
        label_box = draw.textbbox((0, 0), label, font=label_font)
        label_height = label_box[3] - label_box[1]
        draw.text(
            (swatch_left + swatch_width + 6, row_y + max(0, (row_height - label_height) // 2 - 1)),
            label,
            font=label_font,
            fill=FRAME_BORDER,
        )


def _product_subtitle(source_label: str, resolution_label: str, product_label: str) -> str:
    parts = ["North Carolina", source_label]
    if resolution_label and resolution_label.strip().lower() != "native":
        parts.append(resolution_label)
    parts.append(product_label)
    return " · ".join(parts)


def _export_frame(
    radar: Image.Image,
    *,
    valid_time: str,
    bounds: RegionBounds,
    product_id: str,
    product_label: str,
    states: dict[str, Any] | None,
    counties: dict[str, Any] | None,
    width: int,
    source_label: str,
    resolution_label: str,
    unit_label: str,
    frame_number: int,
    frame_count: int,
    playback_fps: int,
    mode_label: str,
    loop_period: str,
) -> Image.Image:
    map_width = width
    map_height = round(map_width * radar.height / radar.width)
    header_height = 58
    footer_height = 34
    map_image = _map_base(bounds, map_width, map_height, states)
    radar_layer = radar.convert("RGBA").resize((map_width, map_height), Image.Resampling.NEAREST)
    map_image.alpha_composite(radar_layer)
    map_draw = ImageDraw.Draw(map_image, "RGBA")
    if counties:
        _draw_geography(map_draw, counties, bounds, map_width, map_height, fill=None, line=COUNTY_COLOR, line_width=1)
    if states:
        _draw_geography(map_draw, states, bounds, map_width, map_height, fill=None, line=STATE_COLOR, line_width=2)
    _draw_city_labels(map_draw, bounds, map_width, map_height)

    canvas = Image.new("RGBA", (width, header_height + map_height + footer_height), (255, 255, 255, 255))
    canvas.alpha_composite(map_image, (0, header_height))
    _draw_vertical_legend(canvas, 0, header_height, map_width, map_height, product_id, unit_label)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rectangle((0, 0, width, header_height - 1), fill=BRAND_NAVY)
    draw.line((0, header_height - 2, width, header_height - 2), fill=BRAND_TEAL, width=2)
    draw.text((14, 7), "wall.cloud Radar", font=_font(18, bold=True), fill=BRAND_TEAL)
    draw.text(
        (14, 35),
        _product_subtitle(source_label, resolution_label, product_label),
        font=_font(12, bold=True),
        fill=BRAND_LIGHT,
    )
    valid_text = f"Valid: {_format_valid_time(valid_time)}"
    valid_font = _font(13, bold=True)
    valid_box = draw.textbbox((0, 0), valid_text, font=valid_font)
    draw.text((width - (valid_box[2] - valid_box[0]) - 14, 9), valid_text, font=valid_font, fill=(255, 255, 255, 255))
    footer_y = header_height + map_height
    draw.rectangle((0, footer_y, width, footer_y + footer_height), fill=BRAND_NAVY)
    draw.line((0, footer_y, width, footer_y), fill=BRAND_TEAL, width=2)
    archive_prefix = "ARCHIVE · " if mode_label.upper() == "ARCHIVE" else ""
    draw.text(
        (14, footer_y + 10),
        f"{archive_prefix}OBSERVED LOOP · {loop_period} · FRAME {frame_number}/{frame_count} · {playback_fps} FPS",
        font=_font(11, bold=True),
        fill=BRAND_LIGHT,
    )
    footer_brand = "wall.cloud"
    footer_font = _font(10, bold=True)
    footer_box = draw.textbbox((0, 0), footer_brand, font=footer_font)
    draw.text(
        (width - (footer_box[2] - footer_box[0]) - 14, footer_y + 11),
        footer_brand,
        font=footer_font,
        fill=BRAND_TEAL,
    )
    draw.rectangle((0, 0, width - 1, canvas.height - 1), outline=FRAME_BORDER, width=1)
    return canvas


def build_loop_gif(
    records: list[dict[str, Any]],
    frame_dir: Path,
    output_path: Path,
    *,
    bounds: RegionBounds,
    source_bounds: RegionBounds | None = None,
    product_id: str,
    product_label: str,
    geography: tuple[dict[str, Any], dict[str, Any]] | None = None,
    width: int = 960,
    frame_duration_ms: int = 180,
    latest_pause_ms: int = 1000,
    source_label: str = "MRMS",
    resolution_label: str = "1 km",
    unit_label: str | None = None,
    mode_label: str = "OBSERVED",
) -> int:
    """Create an atomic, branded GIF from an already-rendered radar sequence."""

    states, counties = geography or (None, None)
    frames: list[Image.Image] = []
    playback_fps = max(1, round(1000 / max(1, frame_duration_ms)))
    existing_records = [
        record
        for record in records
        if (frame_dir / Path(str(record.get("url", ""))).name).is_file()
    ]
    loop_period = _format_loop_period(
        str(existing_records[0]["valid_time"]),
        str(existing_records[-1]["valid_time"]),
    ) if existing_records else "PERIOD UNKNOWN"
    for frame_index, record in enumerate(existing_records):
        path = frame_dir / Path(str(record.get("url", ""))).name
        with Image.open(path) as radar:
            frame_source_bounds = source_bounds or bounds
            record_bounds = record.get("bounds")
            if isinstance(record_bounds, (list, tuple)) and len(record_bounds) == 4:
                try:
                    frame_source_bounds = RegionBounds(
                        west=float(record_bounds[0]),
                        south=float(record_bounds[1]),
                        east=float(record_bounds[2]),
                        north=float(record_bounds[3]),
                    )
                except (TypeError, ValueError):
                    frame_source_bounds = source_bounds or bounds
            cropped_radar = _crop_radar_to_bounds(radar, frame_source_bounds, bounds)
            rendered = _export_frame(
                cropped_radar,
                valid_time=str(record["valid_time"]),
                bounds=bounds,
                product_id=product_id,
                product_label=product_label,
                states=states,
                counties=counties,
                width=width,
                source_label=source_label,
                resolution_label=resolution_label,
                unit_label=unit_label or (
                    "TYPE"
                    if product_id == "PrecipFlag"
                    else "mm"
                    if product_id == "MultiSensor_QPE_01H_Pass1"
                    else "dBZ"
                ),
                frame_number=frame_index + 1,
                frame_count=len(existing_records),
                playback_fps=playback_fps,
                mode_label=mode_label,
                loop_period=loop_period,
            )
            frames.append(rendered.convert("P", palette=Image.Palette.ADAPTIVE, colors=256))
    if not frames:
        raise ValueError("No existing radar frames were available for GIF export")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.stem}.tmp.gif")
    durations = [frame_duration_ms] * len(frames)
    durations[-1] = latest_pause_ms
    try:
        frames[0].save(
            temporary,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            disposal=2,
            optimize=True,
        )
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()
        for frame in frames:
            frame.close()
    LOGGER.info("Built GIF loop %s with %d frames", output_path, len(frames))
    return len(frames)
