from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from radar_processing.config import KRAX_REGION, NexradProcessingConfig, RegionBounds, load_nexrad_config
from radar_processing.nexrad import (
    NexradVolume,
    parse_archive_listing,
    parse_volume_time,
    sample_volumes,
    select_recent_volumes,
)
from radar_processing.nexrad_pipeline import NEXRAD_REFLECTIVITY_ID, build_krax_dataset
from radar_processing.nexrad_rendering import NexradRadarMetadata, grid_reflectivity, raster_height
from radar_processing.rendering import RenderedRaster


def _volume(minute: int) -> NexradVolume:
    valid = datetime(2025, 6, 19, 18, minute, tzinfo=timezone.utc)
    filename = f"KRAX{valid:%Y%m%d_%H%M%S}_V06"
    return NexradVolume("KRAX", valid, f"2025/06/19/KRAX/{filename}", filename, f"https://example.test/{filename}")


def _config(root: Path) -> NexradProcessingConfig:
    return NexradProcessingConfig(
        root=root,
        output_dir=root / "public/data/radar/krax",
        history_dir=root / "public/data/radar/krax/history",
        temp_dir=root / "tmp",
        archive_base_url="https://unidata-nexrad-level2.s3.amazonaws.com",
        realtime_chunks_base_url="https://unidata-nexrad-level2-chunks.s3.amazonaws.com",
        site="KRAX",
        region=KRAX_REGION,
        retention_minutes=90,
        max_frames=18,
        timeout_seconds=30,
        retries=2,
        image_width=600,
        keep_raw=False,
        raw_dir=None,
    )


def test_krax_filename_parser_supports_current_and_legacy_names() -> None:
    expected = datetime(2025, 6, 19, 18, 12, 34, tzinfo=timezone.utc)
    assert parse_volume_time("KRAX20250619_181234_V06") == expected
    assert parse_volume_time("KRAX20250619_181234.gz") == expected
    assert parse_volume_time("KRAX20250619_181234_V06_MDM") is None
    assert parse_volume_time("KMHX20250619_181234_V06") is None


def test_archive_listing_filters_to_krax_and_captures_size() -> None:
    payload = b"""<?xml version="1.0" encoding="UTF-8"?>
    <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Contents><Key>2025/06/19/KRAX/KRAX20250619_181234_V06</Key><Size>12345</Size></Contents>
      <Contents><Key>2025/06/19/KRAX/KRAX20250619_181234_V06_MDM</Key><Size>50</Size></Contents>
      <NextContinuationToken>next-page</NextContinuationToken>
    </ListBucketResult>"""
    volumes, token = parse_archive_listing(payload, base_url="https://example.test")
    assert token == "next-page"
    assert len(volumes) == 1
    assert volumes[0].site == "KRAX"
    assert volumes[0].size == 12345
    assert volumes[0].url.endswith("/2025/06/19/KRAX/KRAX20250619_181234_V06")


def test_recent_volume_retention_and_sampling_are_chronological() -> None:
    volumes = [_volume(minute) for minute in (30, 0, 20, 10, 40)]
    recent = select_recent_volumes(volumes, retention_minutes=25, max_frames=3)
    assert [volume.valid_time.minute for volume in recent] == [20, 30, 40]
    sampled = sample_volumes(volumes, 3)
    assert [volume.valid_time.minute for volume in sampled] == [0, 20, 40]


def test_krax_config_has_nc_coast_and_rejects_other_sites(tmp_path: Path, monkeypatch) -> None:
    config = load_nexrad_config(tmp_path)
    assert config.site == "KRAX"
    assert config.image_width == 2400
    assert config.region.as_list() == [-84.5, 33.0, -74.0, 38.0]
    assert config.region.east >= -74.0
    monkeypatch.setenv("NEXRAD_SITE", "KMHX")
    try:
        load_nexrad_config(tmp_path)
    except ValueError as exc:
        assert "supports KRAX only" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("A non-KRAX site should be rejected")


def test_gate_projection_preserves_max_reflectivity_and_bounds() -> None:
    region = RegionBounds(west=-80, east=-78, south=35, north=37)
    longitudes = np.array([[-79.5, -79.5, -78.5]])
    latitudes = np.array([[36.0, 36.0, 35.5]])
    values = np.ma.array([[10.0, 45.0, 25.0]], mask=[[False, False, False]])
    grid = grid_reflectivity(longitudes, latitudes, values, region, width=200)
    assert grid.shape == (raster_height(region, 200), 200)
    assert np.nanmax(grid) == 45.0
    assert np.count_nonzero(np.isfinite(grid)) > 2


def test_krax_manifest_generation_orders_frames_and_uses_atomic_contract(tmp_path: Path, monkeypatch) -> None:
    config = _config(tmp_path)

    def fake_download(volume: NexradVolume, destination: Path, _config: NexradProcessingConfig) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(volume.filename.encode("ascii"))

    def fake_render(_source: Path, output: Path, region: RegionBounds, *, width: int):
        output.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGBA", (width, 300), (0, 0, 0, 0)).save(output)
        return (
            RenderedRaster(region, width, 300),
            NexradRadarMetadata("reflectivity", 12, 35.665, -78.49, 0.5),
        )

    def fake_loop(records, _frame_dir, output, **_kwargs):
        Image.new("P", (20, 20)).save(output, format="GIF")
        return len(records)

    monkeypatch.setattr("radar_processing.nexrad_pipeline.download_volume", fake_download)
    monkeypatch.setattr("radar_processing.nexrad_pipeline.render_level2_reflectivity", fake_render)
    monkeypatch.setattr("radar_processing.nexrad_pipeline.fetch_export_geography", lambda _config: None)
    monkeypatch.setattr("radar_processing.nexrad_pipeline.build_loop_gif", fake_loop)

    manifest = build_krax_dataset(
        config,
        [_volume(10), _volume(0)],
        output_dir=config.output_dir,
        mode="live",
        dataset_id="krax-live",
        label="KRAX live",
    )
    assert manifest["source"] == "nexrad-level2"
    assert manifest["site"] == "KRAX"
    assert manifest["product"] == NEXRAD_REFLECTIVITY_ID
    assert [frame["valid_time"] for frame in manifest["frames"]] == [
        "2025-06-19T18:00:00Z",
        "2025-06-19T18:10:00Z",
    ]
    assert manifest["radar"]["elevation_degrees"] == 0.5
    assert (config.output_dir / "manifest.json").is_file()
