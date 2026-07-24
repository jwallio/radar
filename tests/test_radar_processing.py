from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import numpy as np
from PIL import Image

from radar_processing.animation import _crop_radar_to_bounds, _draw_vertical_legend, _format_loop_period, _product_subtitle, _vertical_legend_entries, build_loop_gif
from radar_processing.config import ANALYSIS_PRODUCT_IDS, BRANDED_GIF_REGION, DEFAULT_REGION, PRODUCTS
from radar_processing.history import catalog_entry, dataset_id_for_range, update_history_catalog
from radar_processing.manifest import build_manifest, filter_existing_frames, is_stale, retain_frame_records, sort_frame_records, write_json_atomic
from radar_processing.mrms import _archive_listing, sample_frames
from radar_processing.observations import _parse_realtime
from radar_processing.rendering import REFLECTIVITY_STOPS, analysis_palette_for_tests, palette_category_for_tests


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


def test_branded_gif_region_is_tighter_and_central_nc_focused() -> None:
    assert DEFAULT_REGION.west < BRANDED_GIF_REGION.west
    assert DEFAULT_REGION.east > BRANDED_GIF_REGION.east
    assert DEFAULT_REGION.south < BRANDED_GIF_REGION.south
    assert DEFAULT_REGION.north > BRANDED_GIF_REGION.north
    assert BRANDED_GIF_REGION.west < -82.5 < BRANDED_GIF_REGION.east
    assert BRANDED_GIF_REGION.east > -75.5
    assert BRANDED_GIF_REGION.south < 35.5 < BRANDED_GIF_REGION.north
    assert BRANDED_GIF_REGION.north <= 37.0


def test_branded_gif_crop_reduces_regional_source_to_target_bounds() -> None:
    source = Image.new("RGBA", (1300, 700), (12, 34, 56, 255))
    cropped = _crop_radar_to_bounds(source, DEFAULT_REGION, BRANDED_GIF_REGION)
    assert cropped.width < source.width
    assert cropped.height < source.height


def test_analysis_products_are_configured_for_latest_only_rendering() -> None:
    assert len(ANALYSIS_PRODUCT_IDS) == 7
    assert all(PRODUCTS[product_id].render_kind not in {"scalar", "reflectivity", "precip_type"} for product_id in ANALYSIS_PRODUCT_IDS)
    assert PRODUCTS["MESH"].directory == "MESH"
    assert PRODUCTS["NLDN_CG_005min_AvgDensity"].filename_prefix.startswith("MRMS_NLDN_CG")


def test_analysis_palettes_map_weak_signal_to_transparent_and_higher_values_to_color() -> None:
    assert analysis_palette_for_tests("MESH", 1)[3] == 0
    assert analysis_palette_for_tests("MESH", 30)[3] > 0
    # Shear products may decode as physical s^-1; the renderer normalizes that
    # representation to the operational 0.001/s scale before palette lookup.
    assert analysis_palette_for_tests("MergedAzShear_0-2kmAGL", 0.004)[3] > 0


def test_ndbc_realtime_parser_extracts_latest_observation() -> None:
    payload = b"""#YY  MM DD hh mm WDIR WSPD GST WVHT DPD ATMP WTMP PRES\n#yr mo dy hr mn degT m/s m/s m sec degC degC hPa\n2026 07 22 18 40 210 8.4 11.2 1.3 8.0 28.0 26.2 1012.4\n"""
    parsed = _parse_realtime(payload)
    assert parsed is not None
    assert parsed["observed_at"] == "2026-07-22T18:40:00Z"
    assert parsed["wind_speed_mps"] == 8.4
    assert parsed["wave_height_m"] == 1.3


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
        assert gif.size == (180, 182)
        assert gif.info["duration"] == 180
        gif.seek(1)
        assert gif.info["duration"] == 1000


def test_gif_reflectivity_legend_is_vertical_high_to_low() -> None:
    heading, entries, categorical = _vertical_legend_entries("MergedReflectivityQCComposite")
    assert heading == "dBZ"
    assert categorical is False
    assert entries[0][0] == "70+"
    assert entries[-1][0] == "5"


def test_gif_legend_background_is_blended_before_palette_conversion() -> None:
    image = Image.new("RGBA", (300, 300), (0, 0, 0, 255))
    _draw_vertical_legend(image, 0, 0, 300, 300, "MergedReflectivityQCComposite", "dBZ")
    assert image.getpixel((235, 63)) == (128, 128, 128, 255)


def test_gif_loop_period_compacts_matching_eastern_periods() -> None:
    assert _format_loop_period(
        "2026-07-24T12:28:00Z",
        "2026-07-24T13:10:00Z",
    ) == "8:28–9:10 AM ET"


def test_krax_gif_subtitle_omits_native_resolution_label() -> None:
    assert _product_subtitle(
        "KRAX Level II",
        "native",
        "Base Reflectivity",
    ) == "North Carolina · KRAX Level II · Base Reflectivity"
