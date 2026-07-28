from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from .config import NATIONAL_MRMS_REGION, PRODUCTS, ProcessingConfig, RegionBounds
from .manifest import build_manifest, sort_frame_records, write_json_atomic
from .mrms import RemoteFrame, download_file
from .pipeline import REFLECTIVITY_ID, _decompress
from .rendering import load_reflectivity_rgba


LOGGER = logging.getLogger("wallcloud.radar.national")


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _frame_stem(frame: RemoteFrame) -> str:
    return frame.valid_time.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _relative_asset_exists(output_dir: Path, value: object) -> bool:
    path = str(value or "").split("?", 1)[0]
    if not path.startswith("./"):
        return False
    return (output_dir / path[2:]).is_file()


def _existing_frames(manifest: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict):
        return []
    product = manifest.get("products", {}).get(REFLECTIVITY_ID, {})
    frames = product.get("frames", [])
    return [frame for frame in frames if isinstance(frame, dict) and frame.get("valid_time")]


def select_incremental_frames(
    remote_frames: list[RemoteFrame],
    existing_manifest: dict[str, Any] | None,
) -> list[RemoteFrame]:
    """Bootstrap with the latest frame, then process the full rolling selection.

    Publishing one frame first keeps a new or long-stale dataset below the
    five-minute schedule interval. Once a retained frame overlaps the current
    selection, the normal builder reuses it and fills only newer observations.
    """

    if not remote_frames:
        return []
    existing_times = {
        str(frame["valid_time"])
        for frame in _existing_frames(existing_manifest)
    }
    overlapping = [
        frame.valid_time
        for frame in remote_frames
        if frame.timestamp_iso in existing_times
    ]
    if not overlapping:
        return remote_frames[-1:]
    earliest_retained = min(overlapping)
    return [frame for frame in remote_frames if frame.valid_time >= earliest_retained]


def _write_geotiff(rgba, bounds: RegionBounds, output_path: Path) -> None:
    try:
        import rasterio
        from rasterio.transform import from_bounds
    except ImportError as exc:  # pragma: no cover - deployment dependency
        raise RuntimeError("National MRMS tiles require rasterio") from exc

    height, width, _ = rgba.shape
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        output_path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=4,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(bounds.west, bounds.south, bounds.east, bounds.north, width, height),
        tiled=True,
        compress="DEFLATE",
        predictor=2,
    ) as dataset:
        for band in range(4):
            dataset.write(rgba[:, :, band], band + 1)
        dataset.colorinterp = (
            rasterio.enums.ColorInterp.red,
            rasterio.enums.ColorInterp.green,
            rasterio.enums.ColorInterp.blue,
            rasterio.enums.ColorInterp.alpha,
        )


def _write_pmtiles(
    geotiff_path: Path,
    output_path: Path,
    *,
    min_zoom: int,
    max_zoom: int,
    workers: int,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(".pmtiles.part")
    temporary.unlink(missing_ok=True)
    rio_command = shutil.which("rio")
    if rio_command is None:
        sibling = Path(sys.executable).with_name("rio.exe" if sys.platform == "win32" else "rio")
        rio_command = str(sibling) if sibling.is_file() else "rio"
    command = [
        rio_command,
        "pmtiles",
        str(geotiff_path),
        str(temporary),
        "--format",
        "WEBP",
        "--rgba",
        "--co",
        "LOSSLESS=TRUE",
        "--tile-size",
        "512",
        "--zoom-levels",
        f"{min_zoom}..{max_zoom}",
        "--resampling",
        "nearest",
        "--exclude-empty-tiles",
        "-j",
        str(max(1, workers)),
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        detail = (result.stderr or result.stdout or "rio pmtiles failed").strip()
        raise RuntimeError(detail[-1200:])
    temporary.replace(output_path)


def _write_preview(rgba, output_path: Path, *, width: int = 2400) -> None:
    image = Image.fromarray(rgba, mode="RGBA")
    if image.width > width:
        height = max(1, round(image.height * width / image.width))
        image = image.resize((width, height), Image.Resampling.NEAREST)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="WEBP", lossless=True, method=4)


def _render_frame(
    frame: RemoteFrame,
    config: ProcessingConfig,
    raw_dir: Path,
    *,
    region: RegionBounds,
    asset_dir: Path,
    asset_url_prefix: str,
    frame_id_prefix: str,
    filename_prefix: str,
    min_zoom: int,
    max_zoom: int,
    workers: int,
) -> dict[str, Any]:
    stem = _frame_stem(frame)
    gz_path = raw_dir / frame.filename
    grib_path = gz_path.with_suffix("")
    if not gz_path.exists():
        download_file(frame.url, gz_path, config)
    if not grib_path.exists():
        _decompress(gz_path, grib_path)

    rgba, rendered = load_reflectivity_rgba(grib_path, region)
    archive_name = f"{filename_prefix}-{stem}.pmtiles"
    preview_name = f"{filename_prefix}-{stem}.webp"
    archive_path = asset_dir / "frames" / archive_name
    preview_path = asset_dir / "previews" / preview_name
    with tempfile.TemporaryDirectory(prefix="wallcloud-national-", dir=config.temp_dir) as temporary:
        geotiff_path = Path(temporary) / f"{stem}.tif"
        _write_geotiff(rgba, rendered.bounds, geotiff_path)
        _write_pmtiles(
            geotiff_path,
            archive_path,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
            workers=workers,
        )
    _write_preview(rgba, preview_path)
    return {
        "id": f"{frame_id_prefix}-{stem}",
        "valid_time": frame.timestamp_iso,
        "url": f"{asset_url_prefix}/previews/{preview_name}",
        "pmtiles_url": f"{asset_url_prefix}/frames/{archive_name}",
        "bounds": rendered.manifest_bounds(),
        "minzoom": min_zoom,
        "maxzoom": max_zoom,
    }


def _rotate_local_assets(asset_dir: Path, frames: list[dict[str, Any]]) -> None:
    active = {
        Path(str(frame.get(field, "")).split("?", 1)[0]).name
        for frame in frames
        for field in ("url", "pmtiles_url")
    }
    for directory in (asset_dir / "frames", asset_dir / "previews"):
        if not directory.exists():
            continue
        for path in directory.iterdir():
            if path.is_file() and path.name not in active:
                path.unlink()


def _build_mrms_pmtiles_dataset(
    config: ProcessingConfig,
    remote_frames: list[RemoteFrame],
    *,
    region: RegionBounds,
    manifest_path: Path,
    asset_dir: Path,
    asset_url_prefix: str,
    frame_id_prefix: str,
    filename_prefix: str,
    label: str,
    coverage: str,
    dataset_id: str,
    existing_manifest: dict[str, Any] | None = None,
    trust_existing_assets: bool = False,
    min_zoom: int = 3,
    max_zoom: int = 8,
    workers: int = 2,
) -> dict[str, Any]:
    """Build a retained MRMS PMTiles sequence while reusing R2 frame references."""

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    asset_dir.mkdir(parents=True, exist_ok=True)
    config.temp_dir.mkdir(parents=True, exist_ok=True)
    selected_by_time = {frame.timestamp_iso: frame for frame in remote_frames}
    current = {
        str(frame["valid_time"]): frame
        for frame in _existing_frames(existing_manifest)
        if str(frame.get("valid_time")) in selected_by_time
    }
    errors: list[str] = []
    raw_context = tempfile.TemporaryDirectory(prefix="wallcloud-national-raw-", dir=config.temp_dir)
    try:
        raw_dir = Path(raw_context.name)
        for valid_time, frame in selected_by_time.items():
            existing = current.get(valid_time)
            if existing and (
                trust_existing_assets
                or str(existing.get("pmtiles_url", "")).startswith("http")
                or _relative_asset_exists(manifest_path.parent, existing.get("pmtiles_url"))
            ):
                continue
            try:
                current[valid_time] = _render_frame(
                    frame,
                    config,
                    raw_dir,
                    region=region,
                    asset_dir=asset_dir,
                    asset_url_prefix=asset_url_prefix,
                    frame_id_prefix=frame_id_prefix,
                    filename_prefix=filename_prefix,
                    min_zoom=min_zoom,
                    max_zoom=max_zoom,
                    workers=workers,
                )
                LOGGER.info("Rendered %s MRMS frame %s", coverage, valid_time)
            except Exception as exc:  # noqa: BLE001 - preserve the rest of the loop
                message = f"{frame.filename}: {exc}"
                errors.append(message)
                LOGGER.warning("%s frame failed: %s", coverage.capitalize(), message)
    finally:
        raw_context.cleanup()

    frames = sort_frame_records(current.values())
    if not frames:
        raise RuntimeError(f"No {coverage} MRMS reflectivity frames were rendered successfully")
    newest = _parse_time(str(frames[-1]["valid_time"]))
    cutoff = newest - timedelta(minutes=config.retention_minutes)
    frames = [
        frame for frame in frames
        if _parse_time(str(frame["valid_time"])) >= cutoff
    ][-config.max_frames:]
    _rotate_local_assets(asset_dir, frames)

    products = {
        product_id: {
            "label": product.label,
            "status": "ready" if product_id == REFLECTIVITY_ID else "unavailable",
            "frames": frames if product_id == REFLECTIVITY_ID else [],
            **(
                {}
                if product_id == REFLECTIVITY_ID
                else {"notes": "Tiled processing is not enabled for this product yet."}
            ),
        }
        for product_id, product in PRODUCTS.items()
    }
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = build_manifest(
        region=region.as_list(),
        products=products,
        generated_at=generated_at,
        sources={
            "mrms_directory": config.mrms_base_url,
            REFLECTIVITY_ID: f"{config.mrms_base_url}/{PRODUCTS[REFLECTIVITY_ID].directory}/",
        },
        errors=errors[-20:],
        dataset_id=dataset_id,
        label=label,
    )
    manifest["coverage"] = coverage
    manifest["delivery"] = "pmtiles"
    write_json_atomic(manifest_path, manifest)
    return manifest


def build_national_mrms_dataset(
    config: ProcessingConfig,
    remote_frames: list[RemoteFrame],
    *,
    existing_manifest: dict[str, Any] | None = None,
    trust_existing_assets: bool = False,
    min_zoom: int = 3,
    max_zoom: int = 8,
    workers: int = 2,
) -> dict[str, Any]:
    """Build the retained national PMTiles sequence."""

    return _build_mrms_pmtiles_dataset(
        config,
        remote_frames,
        region=NATIONAL_MRMS_REGION,
        manifest_path=config.output_dir / "manifest.json",
        asset_dir=config.output_dir / "national",
        asset_url_prefix="./national",
        frame_id_prefix="mrms-national",
        filename_prefix="reflectivity",
        label="National MRMS · live / recent",
        coverage="conus",
        dataset_id="live",
        existing_manifest=existing_manifest,
        trust_existing_assets=trust_existing_assets,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        workers=workers,
    )


def build_focus_mrms_dataset(
    config: ProcessingConfig,
    remote_frames: list[RemoteFrame],
    *,
    region: RegionBounds,
    region_id: str,
    region_label: str,
    expires_at: str,
    existing_manifest: dict[str, Any] | None = None,
    trust_existing_assets: bool = False,
    min_zoom: int = 4,
    max_zoom: int = 10,
    workers: int = 2,
) -> dict[str, Any]:
    """Build one administrator-selected, higher-detail regional PMTiles sequence."""

    focus_dir = config.output_dir / "focus"
    manifest = _build_mrms_pmtiles_dataset(
        config,
        remote_frames,
        region=region,
        manifest_path=focus_dir / "manifest.json",
        asset_dir=focus_dir,
        asset_url_prefix=".",
        frame_id_prefix=f"mrms-focus-{region_id}",
        filename_prefix=f"reflectivity-{region_id}",
        label=f"Storm focus · {region_label}",
        coverage="regional",
        dataset_id=f"focus-{region_id}",
        existing_manifest=existing_manifest,
        trust_existing_assets=trust_existing_assets,
        min_zoom=min_zoom,
        max_zoom=max_zoom,
        workers=workers,
    )
    manifest["region_id"] = region_id
    manifest["region_label"] = region_label
    manifest["expires_at"] = expires_at
    write_json_atomic(focus_dir / "manifest.json", manifest)
    return manifest


def load_manifest(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return payload if isinstance(payload, dict) else None
