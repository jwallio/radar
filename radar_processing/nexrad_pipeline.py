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
from .nexrad_rendering import NEXRAD_PRODUCT_DEFINITIONS, render_level2_product, render_level2_reflectivity


LOGGER = logging.getLogger("wallcloud.radar.nexrad")
NEXRAD_REFLECTIVITY_ID = "NEXRADLevel2BaseReflectivity"
NEXRAD_PRODUCT_IDS = tuple(NEXRAD_PRODUCT_DEFINITIONS)


def _stem(volume: NexradVolume) -> str:
    return volume.valid_time.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _rotate(frame_dir: Path, loop_dir: Path, frames: list[dict[str, Any]], loop_names: set[str]) -> None:
    active_frames = {Path(str(frame["url"])).name for frame in frames}
    for path in frame_dir.glob("*.png"):
        if path.name not in active_frames:
            path.unlink()
    for path in loop_dir.glob("*.gif"):
        if path.name not in loop_names:
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
    frames_by_product: dict[str, list[dict[str, Any]]] = {product_id: [] for product_id in NEXRAD_PRODUCT_IDS}
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
            try:
                if not source_path.exists():
                    download_volume(volume, source_path, config)
                for product_id in NEXRAD_PRODUCT_IDS:
                    slug = product_id.removeprefix("NEXRADLevel2").lower()
                    output_path = frame_dir / f"krax-{slug}-{stem}.png"
                    try:
                        if product_id == NEXRAD_REFLECTIVITY_ID:
                            # Keep the established base-reflectivity seam available
                            # to downstream integrations and test fixtures.
                            rendered, metadata = render_level2_reflectivity(
                                source_path,
                                output_path,
                                config.region,
                                width=config.image_width,
                            )
                        else:
                            rendered, metadata = render_level2_product(
                                source_path,
                                output_path,
                                config.region,
                                product_id=product_id,
                                width=config.image_width,
                            )
                        if product_id == NEXRAD_REFLECTIVITY_ID:
                            radar_metadata = {
                                "latitude": metadata.radar_latitude,
                                "longitude": metadata.radar_longitude,
                                "sweep_count": metadata.sweep_count,
                                "field": metadata.field_name,
                                "elevation_degrees": metadata.elevation_degrees,
                            }
                        frames_by_product[product_id].append(
                            {
                                "id": f"krax-{slug}-{stem}",
                                "valid_time": volume.timestamp_iso,
                                "url": f"./frames/{output_path.name}",
                                "bounds": rendered.manifest_bounds(),
                                "source_key": volume.key,
                            }
                        )
                    except Exception as exc:  # noqa: BLE001 - one absent field must not discard other products
                        errors.append(f"KRAX {volume.filename} {product_id}: {exc}")
                        LOGGER.warning("KRAX %s %s unavailable: %s", volume.filename, product_id, exc)
                LOGGER.info("[%d/%d] rendered KRAX %s", position, len(volumes), volume.timestamp_iso)
            except Exception as exc:  # noqa: BLE001 - one damaged scan must not discard the sequence
                message = f"KRAX {volume.filename}: {exc}"
                errors.append(message)
                LOGGER.warning(message)

        frames_by_product = {
            product_id: sort_frame_records(filter_existing_frames(records, frame_dir))
            for product_id, records in frames_by_product.items()
        }
        frames = frames_by_product[NEXRAD_REFLECTIVITY_ID]
        if not frames:
            raise RuntimeError("No KRAX Level II reflectivity frames were rendered successfully")

        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            geography = fetch_export_geography(config)  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001
            geography = None
            errors.append(f"GIF boundary overlay: {exc}")
        cache_key = generated_at.replace("-", "").replace(":", "")
        products: dict[str, dict[str, Any]] = {}
        loop_names: set[str] = set()
        for product_id, definition in NEXRAD_PRODUCT_DEFINITIONS.items():
            product_frames = frames_by_product[product_id]
            if not product_frames:
                products[product_id] = {
                    "label": definition["label"],
                    "status": "unavailable",
                    "frames": [],
                    "source_url": config.archive_base_url,
                    "site": config.site,
                    "notes": "This Level II volume set did not contain a decodable field for this product.",
                }
                continue
            loop_name = f"krax-level2-{product_id.removeprefix('NEXRADLevel2').lower()}.gif"
            loop_url: str | None = None
            loop_path = loop_dir / loop_name
            loop_names.add(loop_name)
            try:
                build_loop_gif(
                    product_frames,
                    frame_dir,
                    loop_path,
                    bounds=BRANDED_GIF_REGION,
                    source_bounds=config.region,
                    product_id=product_id,
                    product_label=definition["label"],
                    geography=geography,
                    source_label="KRAX Level II",
                    resolution_label="native",
                    unit_label=definition["unit"],
                    mode_label="ARCHIVE" if mode == "historical" else "OBSERVED",
                )
                loop_url = f"./loops/{loop_name}?v={cache_key}"
            except Exception as exc:  # noqa: BLE001
                errors.append(f"GIF {product_id}: {exc}")
                LOGGER.warning("KRAX GIF export failed for %s: %s", product_id, exc)
            products[product_id] = {
                "label": definition["label"],
                "status": "ready",
                "frames": product_frames,
                "source_url": config.archive_base_url,
                "site": config.site,
                "notes": "Lowest available elevation sweep from each completed KRAX Level II volume.",
            }
            if loop_url:
                products[product_id].update(
                    loop_url=loop_url,
                    loop_frame_count=len(product_frames),
                    loop_size_bytes=loop_path.stat().st_size,
                )
        all_frames = [frame for product_frames in frames_by_product.values() for frame in product_frames]

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
            "products": products,
            "frames": frames,
            "radar": radar_metadata,
            "sources": {
                "nexrad_archive": config.archive_base_url,
                "nexrad_realtime_chunks": config.realtime_chunks_base_url,
            },
            "errors": errors[-20:],
        }
        write_json_atomic(output_dir / "manifest.json", manifest)
        # Publish the complete manifest first. Only then remove frames and
        # loops that are no longer referenced by the successful dataset.
        _rotate(frame_dir, loop_dir, all_frames, loop_names)
        return manifest
    finally:
        if raw_context:
            raw_context.cleanup()
