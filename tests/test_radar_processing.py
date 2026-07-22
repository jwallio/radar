from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import numpy as np
from PIL import Image

from radar_processing.animation import build_loop_gif
from radar_processing.config import DEFAULT_REGION
from radar_processing.history import catalog_entry, dataset_id_for_range, update_history_catalog
from radar_processing.manifest import build_manifest, filter_existing_frames, is_stale, retain_frame_records, sort_frame_records, write_json_atomic
from radar_processing.mrms import _archive_listing, sample_frames
from radar_processing.rendering import REFLECTIVITY_STOPS, palette_category_for_tests


def frame(timestamp: datetime, filename: str) -> dict[str, object]:
    return {
        "id": filename,
        "valid_time": timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "url": f"./frames/{filename}.png",
        "bounds": DEFAULT_REGION.as_list(),
    }


def test_manifest_frames_are_chronological() -> None:
    newest = datetime(2026, 7, 21, 22, 0, tzinfo=timezone.utc)
    records = [frame(newest, "new"), frame(newest - timedelta(minutes=4), "old")]
    assert [item["id"] for item in sort_frame_records(records)] == ["old", "new"]


def test_retention_keeps_recent_frames_and_applies_maximum() -> None:
    newest = datetime(2026, 7, 21, 22, 0, tzinfo=timezone.utc)
    records = [frame(newest - timedelta(minutes=2 * index), str(index)) for index in range(8)]
    retained = retain_frame_records(records, retention_minutes=10, max_frames=3)
    assert [item["id"] for item in retained] == ["2", "1", "0"]


def test_missing_frame_is_omitted(tmp_path: Path) -> None:
    record_a = frame(datetime(2026, 7, 21, 22, 0, tzinfo=timezone.utc), "present")
    record_b = frame(datetime(2026, 7, 21, 21, 58, tzinfo=timezone.utc), "missing")
    (tmp_path / "present.png").write_bytes(b"fixture")
    assert filter_existing_frames([record_a, record_b], tmp_path) == [record_a]


def test_stale_timestamp_detection() -> None:
    now = datetime(2026, 7, 21, 22, 0, tzinfo=timezone.utc)
    fresh = "2026-07-21T21:50:00Z"
    old = "2026-07-21T21:30:00Z"
    assert not is_stale(fresh, now=now, max_age_minutes=15)
    assert is_stale(old, now=now, max_age_minutes=15)
    assert is_stale(None, now=now)


def test_regional_bounds_cover_the_requested_area() -> None:
    assert DEFAULT_REGION.west < -84.3
    assert DEFAULT_REGION.east > -75.4
    assert DEFAULT_REGION.south < 34.0
    assert DEFAULT_REGION.north > 37.8


def test_precipitation_flag_categories_use_published_codes() -> None:
    assert palette_category_for_tests(1) == "rain"
    assert palette_category_for_tests(3) == "snow"
    assert palette_category_for_tests(7) == "hail"
    assert palette_category_for_tests(10) == "cool"
    assert palette_category_for_tests(255) == "unknown"


def test_manifest_generation_is_atomic_and_preserves_product_contract(tmp_path: Path) -> None:
    timestamp = datetime(2026, 7, 21, 22, 0, tzinfo=timezone.utc)
    reflectivity = frame(timestamp, "reflectivity")
    precip = frame(timestamp, "precip")
    manifest = build_manifest(
        region=DEFAULT_REGION.as_list(),
        products={
            "MergedReflectivityQCComposite": {"label": "Composite Reflectivity", "status": "ready", "frames": [reflectivity]},
            "PrecipFlag": {"label": "Precipitation Type", "status": "ready", "frames": [precip]},
        },
        generated_at="2026-07-21T22:01:00Z",
        sources={"reflectivity": "https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/"},
    )
    output = tmp_path / "manifest.json"
    write_json_atomic(output, manifest)
    loaded = json.loads(output.read_text(encoding="utf-8"))
    assert loaded["status"] == "ready"
    assert loaded["latest_valid_time"] == "2026-07-21T22:00:00Z"
    assert loaded["mode"] == "live"
    assert loaded["dataset_id"] == "live"
    assert set(loaded["products"]) == {"MergedReflectivityQCComposite", "PrecipFlag"}


def test_reflectivity_palette_uses_two_dbz_bins() -> None:
    assert REFLECTIVITY_STOPS[0] == 5
    assert REFLECTIVITY_STOPS[-1] == 71
    assert np.all(np.diff(REFLECTIVITY_STOPS) == 2)


def test_archive_listing_and_even_sampling() -> None:
    payload = b"""<?xml version='1.0' encoding='UTF-8'?>
    <ListBucketResult xmlns='http://s3.amazonaws.com/doc/2006-03-01/'>
      <Contents><Key>CONUS/MergedReflectivityQCComposite_00.50/20250619/MRMS_MergedReflectivityQCComposite_00.50_20250619-190041.grib2.gz</Key></Contents>
      <Contents><Key>CONUS/MergedReflectivityQCComposite_00.50/20250619/MRMS_MergedReflectivityQCComposite_00.50_20250619-190241.grib2.gz</Key></Contents>
      <NextContinuationToken>next-page</NextContinuationToken>
    </ListBucketResult>"""
    frames, token = _archive_listing(payload, "https://noaa-mrms-pds.s3.amazonaws.com")
    assert token == "next-page"
    assert len(frames) == 2
    assert frames[0].valid_time == datetime(2025, 6, 19, 19, 0, 41, tzinfo=timezone.utc)
    sampled = sample_frames(frames * 3, 2)
    assert len(sampled) == 2


def test_history_catalog_replaces_duplicate_and_sorts(tmp_path: Path) -> None:
    start = datetime(2025, 6, 19, 19, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=60)
    dataset_id = dataset_id_for_range(start, end)
    manifest = build_manifest(
        region=DEFAULT_REGION.as_list(),
        products={
            "MergedReflectivityQCComposite": {
                "label": "Composite Reflectivity",
                "status": "ready",
                "frames": [frame(start, "historic")],
            }
        },
        generated_at="2025-06-19T20:01:00Z",
        sources={"reflectivity": "https://noaa-mrms-pds.s3.amazonaws.com"},
        mode="historical",
        dataset_id=dataset_id,
        label="June 19 test",
        start_time="2025-06-19T19:00:00Z",
        end_time="2025-06-19T20:00:00Z",
    )
    catalog_path = tmp_path / "catalog.json"
    update_history_catalog(catalog_path, catalog_entry(manifest))
    catalog = update_history_catalog(catalog_path, catalog_entry(manifest))
    assert len(catalog["datasets"]) == 1
    assert catalog["datasets"][0]["manifest_url"] == f"./{dataset_id}/manifest.json"


def test_gif_export_contains_all_frames(tmp_path: Path) -> None:
    records: list[dict[str, object]] = []
    for index, color in enumerate(((0, 220, 70, 220), (240, 50, 40, 240))):
        timestamp = datetime(2026, 7, 21, 22, index * 2, tzinfo=timezone.utc)
        record = frame(timestamp, f"gif-{index}")
        records.append(record)
        Image.new("RGBA", (24, 12), color).save(tmp_path / f"gif-{index}.png")
    output = tmp_path / "loop.gif"
    count = build_loop_gif(
        records,
        tmp_path,
        output,
        bounds=DEFAULT_REGION,
        product_id="MergedReflectivityQCComposite",
        product_label="Composite Reflectivity",
        width=180,
    )
    assert count == 2
    with Image.open(output) as gif:
        assert gif.format == "GIF"
        assert gif.n_frames == 2
