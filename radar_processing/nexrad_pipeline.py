from __future__ import annotations

import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .animation import build_loop_gif, fetch_export_geography
from .config import BRANDED_GIF_REGION, NexradProcessingConfig
from .manifest import filter_existing_frames, sort_frame_records, write_json_atomic
from .nexrad import NexradVolume, download_volume
from .nexrad_rendering import render_level2_reflectivity


LOGGER = logging.getLogger("wallcloud.radar.nexrad")
NEXRAD_REFLECTIVITY_ID = "NEXRADLevel2BaseReflectivity"


def _stem(volume: NexradVolume) -> str:
    return volume.valid_time.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _rotate(frame_dir: Path, loop_dir: Path, frames: list[dict[str, Any]], loop_name: str | None) -> None:
    active_frames = {Path(str(frame["url"])).name for frame in frames}
    for path in frame_dir.glob("*.png"):
        if path.name not in active_frames:
            path.unlink()
    for path in loop_dir.glob("*.gif"):
        if loop_name is None or path.name != loop_name:
            path.unlink()


def build_krax_dataset(
    config: NexradProcessingConfig,
    volumes: list[NexradVolume],
    *,
    output_dir: Path,
    mode: str,
    dataset_id: str,
    label: str,
    start_time: str | None = None,
    end_time: str | None = None,
) -> dict[str, Any]:
    """Render KRAX volumes, create a branded loop, and atomically publish a manifest."""

    frame_dir = output_dir / "frames"
    loop_dir = output_dir / "loops"
    frame_dir.mkdir(parents=True, exist_ok=True)
    loop_dir.mkdir(parents=True, exist_ok=True)
    config.temp_dir.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    frames: list[dict[str, Any]] = []
    radar_metadata: dict[str, Any] = {}
    raw_context = (
        tempfile.TemporaryDirectory(prefix="wallcloud-krax-", dir=config.temp_dir)
        if not config.keep_raw
        else None
    )
    try:
        raw_dir = Path(raw_context.name) if raw_context else (config.raw_dir or config.root / ".nexrad-raw")
        raw_dir.mkdir(parents=True, exist_ok=True)
        for position, volume in enumerate(volumes, start=1):
            stem = _stem(volume)
            source_path = raw_dir / config.site / volume.filename
            output_path = frame_dir / f"krax-base-reflectivity-{stem}.png"
            try:
                if not source_path.exists():
                    download_volume(volume, source_path, config)
                rendered, metadata = render_level2_reflectivity(
                    source_path,
                    output_path,
                    config.region,
                    width=config.image_width,
                )
                radar_metadata = {
                    "latitude": metadata.radar_latitude,
                    "longitude": metadata.radar_longitude,
                    "sweep_count": metadata.sweep_count,
                    "field": metadata.field_name,
                    "elevation_degrees": metadata.elevation_degrees,
                }
                frames.append(
                    {
                        "id": f"krax-{stem}",
                        "valid_time": volume.timestamp_iso,
                        "url": f"./frames/{output_path.name}",
                        "bounds": rendered.manifest_bounds(),
                        "source_key": volume.key,
                    }
                )
                LOGGER.info("[%d/%d] rendered KRAX %s", position, len(volumes), volume.timestamp_iso)
            except Exception as exc:  # noqa: BLE001 - one damaged scan must not discard the sequence
                message = f"KRAX {volume.filename}: {exc}"
                errors.append(message)
                LOGGER.warning(message)

        frames = sort_frame_records(filter_existing_frames(frames, frame_dir))
        if not frames:
            raise RuntimeError("No KRAX Level II reflectivity frames were rendered successfully")

        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        loop_name = "krax-level2-base-reflectivity.gif"
        loop_url: str | None = None
        try:
            geography = fetch_export_geography(config)  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001
            geography = None
            errors.append(f"GIF boundary overlay: {exc}")
        try:
            build_loop_gif(
                frames,
                frame_dir,
                loop_dir / loop_name,
                bounds=BRANDED_GIF_REGION,
                source_bounds=config.region,
                product_id=NEXRAD_REFLECTIVITY_ID,
                product_label="Base Reflectivity",
                geography=geography,
                source_label="KRAX Level II",
                resolution_label="native",
                unit_label="dBZ",
                mode_label="ARCHIVE" if mode == "historical" else "OBSERVED",
            )
            cache_key = generated_at.replace("-", "").replace(":", "")
            loop_url = f"./loops/{loop_name}?v={cache_key}"
        except Exception as exc:  # noqa: BLE001
            errors.append(f"GIF {NEXRAD_REFLECTIVITY_ID}: {exc}")
            LOGGER.warning("KRAX GIF export failed: %s", exc)

        product: dict[str, Any] = {
            "label": "KRAX Base Reflectivity",
            "status": "ready",
            "frames": frames,
            "source_url": config.archive_base_url,
            "site": config.site,
            "notes": "Single-site base reflectivity from the lowest available elevation sweep in each completed KRAX Level II volume.",
        }
        if loop_url:
            loop_path = loop_dir / loop_name
            product.update(
                loop_url=loop_url,
                loop_frame_count=len(frames),
                loop_size_bytes=loop_path.stat().st_size,
            )
        _rotate(frame_dir, loop_dir, frames, loop_name if loop_url else None)

        latest = str(frames[-1]["valid_time"])
        manifest = {
            "schema_version": 1,
            "status": "ready",
            "mode": mode,
            "source": "nexrad-level2",
            "site": config.site,
            "dataset_id": dataset_id,
            "label": label,
            "generated_at": generated_at,
            "latest_valid_time": latest,
            "start_time": start_time or str(frames[0]["valid_time"]),
            "end_time": end_time or latest,
            "region": {
                "west": config.region.west,
                "south": config.region.south,
                "east": config.region.east,
                "north": config.region.north,
            },
            "product": NEXRAD_REFLECTIVITY_ID,
            "products": {NEXRAD_REFLECTIVITY_ID: product},
            "frames": frames,
            "radar": radar_metadata,
            "sources": {
                "nexrad_archive": config.archive_base_url,
                "nexrad_realtime_chunks": config.realtime_chunks_base_url,
            },
            "errors": errors[-20:],
        }
        write_json_atomic(output_dir / "manifest.json", manifest)
        return manifest
    finally:
        if raw_context:
            raw_context.cleanup()
