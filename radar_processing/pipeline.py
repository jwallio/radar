from __future__ import annotations

import gzip
import logging
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .animation import build_loop_gif, fetch_export_geography
from .config import ANALYSIS_PRODUCT_IDS, BRANDED_GIF_REGION, PRODUCTS, ProcessingConfig
from .manifest import build_manifest, filter_existing_frames, sort_frame_records, write_json_atomic
from .mrms import RemoteFrame, download_file, match_closest_frame
from .rendering import render_analysis, render_precip_type, render_reflectivity


LOGGER = logging.getLogger("wallcloud.radar.pipeline")
REFLECTIVITY_ID = "MergedReflectivityQCComposite"
PRECIP_ID = "PrecipFlag"


def _decompress(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(source, "rb") as compressed, destination.open("wb") as output:
        shutil.copyfileobj(compressed, output)


def _safe_stem(frame: RemoteFrame) -> str:
    return frame.valid_time.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _frame_payload(
    frame: RemoteFrame,
    filename: str,
    bounds: list[float],
    *,
    frame_id_prefix: str = "mrms",
    **extra: object,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": f"{frame_id_prefix}-{_safe_stem(frame)}",
        "valid_time": frame.timestamp_iso,
        "url": f"./frames/{filename}",
        "bounds": bounds,
    }
    payload.update(extra)
    return payload


def _download_and_decompress(
    frame: RemoteFrame,
    *,
    product_id: str,
    raw_dir: Path,
    config: ProcessingConfig,
) -> Path:
    gz_path = raw_dir / product_id / frame.filename
    grib_path = gz_path.with_suffix("")
    if not grib_path.exists():
        if not gz_path.exists():
            LOGGER.debug("Downloading %s", frame.url)
            download_file(frame.url, gz_path, config)
        _decompress(gz_path, grib_path)
    return grib_path


def _product_payloads(sources: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Create a stable manifest contract for every configured MRMS product."""

    payloads: dict[str, dict[str, Any]] = {}
    for product_id, definition in PRODUCTS.items():
        payload: dict[str, Any] = {
            "label": definition.label,
            "status": "unavailable",
            "frames": [],
        }
        source_url = sources.get(product_id)
        if source_url:
            payload["source_url"] = source_url
        payloads[product_id] = payload
    return payloads


def _safe_product_stem(product_id: str) -> str:
    return "".join(character.lower() if character.isalnum() else "-" for character in product_id).strip("-")


def _rotate_outputs(frame_dir: Path, loop_dir: Path, products: dict[str, dict[str, Any]]) -> None:
    active_frames = {
        Path(str(frame["url"])).name
        for product in products.values()
        for frame in product["frames"]
    }
    for old_frame in frame_dir.glob("*.png"):
        if old_frame.name not in active_frames:
            old_frame.unlink()

    active_loops = {
        Path(str(product["loop_url"])).name
        for product in products.values()
        if product.get("loop_url")
    }
    for old_loop in loop_dir.glob("*.gif"):
        if old_loop.name not in active_loops:
            old_loop.unlink()


def build_radar_dataset(
    config: ProcessingConfig,
    reflectivity_frames: list[RemoteFrame],
    precip_candidates: list[RemoteFrame],
    *,
    output_dir: Path,
    mode: str,
    dataset_id: str,
    label: str,
    sources: dict[str, str],
    auxiliary_frames: dict[str, RemoteFrame] | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
) -> dict[str, Any]:
    """Render one live or historical dataset, its GIFs, and an atomic manifest."""

    frame_dir = output_dir / "frames"
    loop_dir = output_dir / "loops"
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)
    loop_dir.mkdir(parents=True, exist_ok=True)
    config.temp_dir.mkdir(parents=True, exist_ok=True)

    products = _product_payloads(sources)
    errors: list[str] = []
    raw_context = (
        tempfile.TemporaryDirectory(prefix="wallcloud-mrms-", dir=config.temp_dir)
        if not config.keep_raw
        else None
    )
    try:
        raw_dir = Path(raw_context.name) if raw_context else (config.raw_dir or config.root / ".radar-raw")
        raw_dir.mkdir(parents=True, exist_ok=True)
        for position, frame in enumerate(reflectivity_frames, start=1):
            stem = _safe_stem(frame)
            reflectivity_filename = f"reflectivity-{stem}.png"
            reflectivity_path = frame_dir / reflectivity_filename
            try:
                reflectivity_grib = _download_and_decompress(
                    frame,
                    product_id=REFLECTIVITY_ID,
                    raw_dir=raw_dir,
                    config=config,
                )
                rendered = render_reflectivity(reflectivity_grib, reflectivity_path, config.region)
                products[REFLECTIVITY_ID]["frames"].append(
                    _frame_payload(frame, reflectivity_filename, rendered.manifest_bounds())
                )
                LOGGER.info("[%d/%d] rendered reflectivity %s", position, len(reflectivity_frames), frame.timestamp_iso)
            except Exception as exc:  # noqa: BLE001 - retain a usable sequence when one source frame is bad
                message = f"Reflectivity {frame.filename}: {exc}"
                errors.append(message)
                LOGGER.warning(message)
                continue

            if not config.include_precip_type or not precip_candidates:
                continue
            precip_frame = match_closest_frame(frame.valid_time, precip_candidates)
            if precip_frame is None:
                LOGGER.warning("No nearby PrecipFlag frame for %s", frame.timestamp_iso)
                continue
            precip_filename = f"precip-type-{stem}.png"
            precip_path = frame_dir / precip_filename
            try:
                precip_grib = _download_and_decompress(
                    precip_frame,
                    product_id=PRECIP_ID,
                    raw_dir=raw_dir,
                    config=config,
                )
                precip_rendered = render_precip_type(
                    reflectivity_grib,
                    precip_grib,
                    precip_path,
                    config.region,
                )
                products[PRECIP_ID]["frames"].append(
                    _frame_payload(
                        frame,
                        precip_filename,
                        precip_rendered.manifest_bounds(),
                        source_valid_time=precip_frame.timestamp_iso,
                    )
                )
            except Exception as exc:  # noqa: BLE001 - reflectivity remains valid if classification fails
                message = f"PrecipFlag {precip_frame.filename}: {exc}"
                errors.append(message)
                LOGGER.warning(message)

        # Analysis products are deliberately latest-only for the live MVP. A
        # full animation of every derived product would multiply GRIB2
        # downloads and processing time without improving the primary loop.
        for product_id, frame in (auxiliary_frames or {}).items():
            if product_id not in ANALYSIS_PRODUCT_IDS:
                LOGGER.warning("Ignoring unconfigured auxiliary MRMS product %s", product_id)
                continue
            filename = f"analysis-{_safe_product_stem(product_id)}-{_safe_stem(frame)}.png"
            output_path = frame_dir / filename
            try:
                grib_path = _download_and_decompress(
                    frame,
                    product_id=product_id,
                    raw_dir=raw_dir,
                    config=config,
                )
                rendered = render_analysis(product_id, grib_path, output_path, config.region)
                products[product_id]["frames"] = [
                    _frame_payload(
                        frame,
                        filename,
                        rendered.manifest_bounds(),
                        frame_id_prefix=f"analysis-{_safe_product_stem(product_id)}",
                    )
                ]
                LOGGER.info("Rendered latest %s analysis %s", product_id, frame.timestamp_iso)
            except Exception as exc:  # noqa: BLE001 - one layer must not discard the radar loop
                message = f"{product_id} {frame.filename}: {exc}"
                errors.append(message)
                LOGGER.warning(message)

        for product_id, product in products.items():
            frames = sort_frame_records(filter_existing_frames(product["frames"], frame_dir))
            product["frames"] = frames
            if frames:
                product["status"] = (
                    "partial"
                    if product_id == PRECIP_ID and len(frames) < len(products[REFLECTIVITY_ID]["frames"])
                    else "ready"
                )
            elif product_id == PRECIP_ID:
                product["notes"] = "Precipitation-type processing unavailable for this dataset."
            elif product_id in ANALYSIS_PRODUCT_IDS:
                product["notes"] = "Latest analysis frame unavailable for this dataset."

        reflectivity_payload = products[REFLECTIVITY_ID]["frames"]
        if not reflectivity_payload:
            raise RuntimeError("No MRMS reflectivity frames were rendered successfully")

        try:
            geography = fetch_export_geography(config)
        except Exception as exc:  # noqa: BLE001 - GIF remains useful with grid/cities fallback
            geography = None
            errors.append(f"GIF boundary overlay: {exc}")
            LOGGER.warning("Census boundary overlay unavailable for GIF export: %s", exc)

        loop_names = {
            REFLECTIVITY_ID: "composite-reflectivity.gif",
            PRECIP_ID: "precipitation-type.gif",
        }
        for product_id, product in products.items():
            if not product["frames"]:
                continue
            loop_name = loop_names.get(product_id)
            if not loop_name:
                continue
            loop_path = loop_dir / loop_name
            try:
                frame_count = build_loop_gif(
                    product["frames"],
                    frame_dir,
                    loop_path,
                    bounds=BRANDED_GIF_REGION,
                    product_id=product_id,
                    product_label=str(product["label"]),
                    geography=geography,
                )
                product["loop_url"] = f"./loops/{loop_path.name}"
                product["loop_frame_count"] = frame_count
                product["loop_size_bytes"] = loop_path.stat().st_size
            except Exception as exc:  # noqa: BLE001 - GIF failure must not discard browser animation
                errors.append(f"GIF {product_id}: {exc}")
                LOGGER.warning("GIF export failed for %s: %s", product_id, exc)

        _rotate_outputs(frame_dir, loop_dir, products)
        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        manifest = build_manifest(
            region=config.region.as_list(),
            products=products,
            generated_at=generated_at,
            sources=sources,
            errors=errors[-20:],
            mode=mode,
            dataset_id=dataset_id,
            label=label,
            start_time=start_time,
            end_time=end_time,
        )
        write_json_atomic(output_dir / "manifest.json", manifest)
        LOGGER.info(
            "Manifest atomically replaced: %d reflectivity frames, %d precipitation-type frames",
            len(products[REFLECTIVITY_ID]["frames"]),
            len(products[PRECIP_ID]["frames"]),
        )
        return manifest
    finally:
        if raw_context:
            raw_context.cleanup()

