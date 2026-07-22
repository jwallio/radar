from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import ProcessingConfig
from .manifest import write_json_atomic
from .mrms import request_bytes


LOGGER = logging.getLogger("wallcloud.observations")
NDBC_ACTIVE_STATIONS_URL = "https://www.ndbc.noaa.gov/activestations.xml"
NDBC_REALTIME_BASE_URL = "https://www.ndbc.noaa.gov/data/realtime2"


def _float(value: str | None) -> float | None:
    if value is None or value.strip() in {"", "MM", "99", "999", "9999"}:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if number == number else None


def _station_list(payload: bytes, config: ProcessingConfig) -> list[dict[str, Any]]:
    root = ET.fromstring(payload)
    stations: list[dict[str, Any]] = []
    for element in root.findall(".//station"):
        if element.attrib.get("met", "").lower() != "y":
            continue
        station_id = element.attrib.get("id")
        latitude = _float(element.attrib.get("lat"))
        longitude = _float(element.attrib.get("lon"))
        if not station_id or latitude is None or longitude is None:
            continue
        if not (
            config.region.west <= longitude <= config.region.east
            and config.region.south <= latitude <= config.region.north
        ):
            continue
        stations.append(
            {
                "id": station_id,
                "name": element.attrib.get("name") or station_id,
                "lat": latitude,
                "lon": longitude,
            }
        )
    return sorted(stations, key=lambda station: station["id"])


def _parse_realtime(payload: bytes) -> dict[str, Any] | None:
    lines = payload.decode("utf-8", errors="replace").splitlines()
    header: list[str] | None = None
    row: list[str] | None = None
    for line in lines:
        if line.startswith("#YY"):
            header = line.lstrip("#").split()
            continue
        if header and line.strip() and not line.startswith("#"):
            values = line.split()
            if len(values) >= len(header):
                row = values
                break
    if not header or not row:
        return None
    values = dict(zip(header, row))
    year = _float(values.get("YY"))
    month = _float(values.get("MM"))
    day = _float(values.get("DD"))
    hour = _float(values.get("hh"))
    minute = _float(values.get("mm"))
    observed_at: str | None = None
    if None not in {year, month, day, hour, minute}:
        year_int = int(year)
        if year_int < 100:
            year_int += 2000
        try:
            observed_at = datetime(
                year_int,
                int(month),
                int(day),
                int(hour),
                int(minute),
                tzinfo=timezone.utc,
            ).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            observed_at = None
    return {
        "observed_at": observed_at,
        "wind_direction_deg": _float(values.get("WDIR")),
        "wind_speed_mps": _float(values.get("WSPD")),
        "wind_gust_mps": _float(values.get("GST")),
        "wave_height_m": _float(values.get("WVHT")),
        "dominant_period_s": _float(values.get("DPD")),
        "air_temp_c": _float(values.get("ATMP")),
        "water_temp_c": _float(values.get("WTMP")),
        "pressure_hpa": _float(values.get("PRES")),
    }


def build_buoy_observations(
    config: ProcessingConfig,
    output_path: Path,
    *,
    limit: int = 30,
) -> dict[str, Any]:
    """Build a small static NDBC feed for the coastal map overlay."""

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result: dict[str, Any] = {
        "schema_version": 1,
        "status": "unavailable",
        "generated_at": generated_at,
        "source": NDBC_ACTIVE_STATIONS_URL,
        "stations": [],
    }
    try:
        stations = _station_list(request_bytes(NDBC_ACTIVE_STATIONS_URL, config), config)[: max(1, limit)]
    except Exception as exc:  # noqa: BLE001 - buoy data is an optional overlay
        result["notes"] = f"NDBC station list unavailable: {exc}"
        write_json_atomic(output_path, result)
        LOGGER.warning(result["notes"])
        return result

    for station in stations:
        url = f"{NDBC_REALTIME_BASE_URL}/{station['id']}.txt"
        try:
            parsed = _parse_realtime(request_bytes(url, config))
        except Exception as exc:  # noqa: BLE001 - retain stations that do respond
            LOGGER.debug("NDBC station %s unavailable: %s", station["id"], exc)
            continue
        if parsed is None:
            continue
        parsed.update(station)
        result["stations"].append(parsed)

    result["status"] = "ready" if result["stations"] else "unavailable"
    if result["status"] == "unavailable":
        result["notes"] = "No active NDBC stations returned a parseable latest observation."
    write_json_atomic(output_path, result)
    LOGGER.info("Wrote %d NDBC buoy observations to %s", len(result["stations"]), output_path)
    return result
