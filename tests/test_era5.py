from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image
import pytest
import xarray as xr

from radar_processing.config import ATLANTIC_CARIBBEAN_REGION, RegionBounds
from radar_processing.era5 import (
    ERA5_PROCESSING_BOUNDS,
    ERA5_MAX_FRAMES,
    ERA5_MIN_TIME,
    Era5HourlyGrid,
    build_cds_request,
    build_era5_dataset,
    download_era5_months,
    era5_dataset_id,
    expected_era5_hours,
    _find_variable,
    _iter_variable_slices,
    validate_era5_bounds,
    validate_era5_request,
)
from radar_processing.era5_rendering import (
    crop_era5_grid,
    palette_color_for_tests,
    precipitation_rate_mm_per_hour,
    precipitation_type_category,
    render_era5_frame,
)
from radar_processing.history import parse_timestamp


ERA5_REGION = RegionBounds(west=-81.0, east=-78.0, south=34.0, north=37.0)


def test_era5_ptype_uses_ecmwf_code_table_categories() -> None:
    assert precipitation_type_category(0) == "none"
    assert precipitation_type_category(1) == "rain"
    assert precipitation_type_category(3) == "freezing-rain"
    assert precipitation_type_category(5) == "snow"
    assert precipitation_type_category(6) == "wet-snow"
    assert precipitation_type_category(7) == "mixed-rain-snow"
    assert precipitation_type_category(8) == "ice-pellets"
    assert precipitation_type_category(255) == "unknown"


def test_era5_total_precipitation_is_converted_from_metres_to_hourly_mm() -> None:
    result = precipitation_rate_mm_per_hour(np.asarray([[0.001, -0.1, np.nan]], dtype=np.float32))
    assert result[0, 0] == pytest.approx(1.0)
    assert result[0, 1] == 0
    assert np.isnan(result[0, 2])


def test_era5_phase_palette_separates_rain_snow_freezing_mixed_and_pellets() -> None:
    colors = {
        code: palette_color_for_tests("phase", code, 5.0)
        for code in (1, 3, 5, 7, 8)
    }
    assert len(set(colors.values())) == 5
    assert palette_color_for_tests("phase", 0, 0.0)[3] == 0
    assert palette_color_for_tests("phase", 1, 100.0)[3] > 0
    assert palette_color_for_tests("total", 1, 0.1)[3] > 0


def test_era5_validation_rejects_global_future_subhourly_and_oversized_requests() -> None:
    with pytest.raises(ValueError, match="whole UTC hours"):
        validate_era5_request(
            datetime(2025, 1, 1, 0, 30, tzinfo=timezone.utc),
            datetime(2025, 1, 1, 1, tzinfo=timezone.utc),
            ERA5_REGION,
        )
    with pytest.raises(ValueError, match="future"):
        validate_era5_request(
            datetime(2026, 8, 8, 0, tzinfo=timezone.utc),
            datetime(2026, 8, 8, 1, tzinfo=timezone.utc),
            ERA5_REGION,
            now=datetime(2026, 8, 7, 23, tzinfo=timezone.utc),
        )
    with pytest.raises(ValueError, match="inside the ERA5 processing domain"):
        validate_era5_bounds(RegionBounds(west=-80, east=-55, south=9, north=20))
    validate_era5_bounds(ATLANTIC_CARIBBEAN_REGION)
    assert ERA5_PROCESSING_BOUNDS.as_list() == [-130.0, 10.0, -55.0, 55.0]
    with pytest.raises(ValueError, match="1940"):
        validate_era5_request(
            ERA5_MIN_TIME - timedelta(hours=1),
            ERA5_MIN_TIME,
            ERA5_REGION,
        )


def test_era5_cds_request_uses_official_dataset_variables_and_area_order() -> None:
    request = build_cds_request(2025, 1, [2, 1, 2], ERA5_REGION)
    assert request["product_type"] == ["reanalysis"]
    assert request["variable"] == ["precipitation_type", "total_precipitation"]
    assert request["day"] == ["01", "02"]
    assert len(request["time"]) == 24
    assert request["area"] == [37.0, -81.0, 34.0, -78.0]
    assert request["data_format"] == "grib"
    assert request["download_format"] == "unarchived"

    boundary_request = build_cds_request(2025, 1, [2], ERA5_REGION, hours=[23, 0, 23])
    assert boundary_request["time"] == ["00:00", "23:00"]


def test_era5_download_requests_only_boundary_hours(tmp_path: Path) -> None:
    requests: list[dict[str, object]] = []

    class FakeClient:
        def retrieve(self, _dataset: str, request: dict[str, object], target: str) -> None:
            requests.append(request)
            Path(target).write_bytes(b"grib")

    download_era5_months(
        FakeClient(),
        datetime(2025, 1, 1, 22, tzinfo=timezone.utc),
        datetime(2025, 1, 2, 2, tzinfo=timezone.utc),
        ERA5_REGION,
        tmp_path,
    )
    assert [request["time"] for request in requests] == [["00:00", "01:00"], ["22:00", "23:00"]]


def test_era5_decoder_matches_authoritative_grib_parameter_ids() -> None:
    ptype = SimpleNamespace(attrs={"GRIB_paramId": 260015})
    total = SimpleNamespace(attrs={"GRIB_paramId": 228})
    dataset = SimpleNamespace(data_vars={"unknown": ptype, "field": total})

    assert _find_variable(dataset, "ptype") is ptype
    assert _find_variable(dataset, "tp") is total


def test_era5_decoder_preserves_cfgrib_valid_time_when_slicing_hourly_fields() -> None:
    field = xr.DataArray(
        np.zeros((2, 1, 1), dtype=np.float32),
        dims=("step", "latitude", "longitude"),
        coords={
            "time": np.datetime64("2024-09-26T18:00:00"),
            "step": np.asarray([np.timedelta64(6, "h"), np.timedelta64(7, "h")]),
            "valid_time": ("step", np.asarray(["2024-09-27T00:00:00", "2024-09-27T01:00:00"], dtype="datetime64[ns]")),
            "latitude": np.asarray([35.0]),
            "longitude": np.asarray([280.0]),
        },
    )

    slices = list(_iter_variable_slices(field))

    assert [item[0] for item in slices] == [
        datetime(2024, 9, 27, 0, tzinfo=timezone.utc),
        datetime(2024, 9, 27, 1, tzinfo=timezone.utc),
    ]
    assert np.array_equal(slices[0][3], np.asarray([-80.0]))


def test_era5_dataset_id_is_deterministic_and_bound_to_region() -> None:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    first = era5_dataset_id(start, end, "North Carolina", ERA5_REGION)
    second = era5_dataset_id(start, end, "north-carolina", ERA5_REGION)
    other = era5_dataset_id(start, end, "north-carolina", RegionBounds(-80, -77, 34, 37))
    assert first == second
    assert first.startswith("era5-north-carolina-20250101T0000Z-20250101T0200Z-b")
    assert first.endswith("-v1")
    assert first != other


def test_era5_history_keeps_eastern_offsets_and_orders_exact_utc_hours() -> None:
    winter = parse_timestamp("2025-01-01T00:00:00-05:00")
    summer = parse_timestamp("2025-07-01T00:00:00-04:00")
    assert winter.isoformat() == "2025-01-01T05:00:00+00:00"
    assert summer.isoformat() == "2025-07-01T04:00:00+00:00"
    assert expected_era5_hours(winter, winter + timedelta(hours=3)) == [
        winter,
        winter + timedelta(hours=1),
        winter + timedelta(hours=2),
    ]


def test_era5_crop_preserves_native_grid_and_actual_cell_bounds() -> None:
    values = np.arange(20, dtype=np.float32).reshape(4, 5)
    lats = np.asarray([38.0, 37.75, 37.5, 37.25])
    lons = np.asarray([-82.0, -81.75, -81.5, -81.25, -81.0])
    cropped, selected_lats, selected_lons, bounds = crop_era5_grid(
        values,
        lats,
        lons,
        RegionBounds(-82.1, -80.9, 37.0, 38.1),
    )
    assert cropped.shape == (4, 5)
    assert selected_lats[0] > selected_lats[-1]
    assert selected_lons[0] == -82.0
    assert bounds.west == pytest.approx(-82.125)
    assert bounds.north == pytest.approx(38.125)


def test_era5_frame_renderer_writes_phase_and_total_assets(tmp_path: Path) -> None:
    ptype = np.asarray([[1, 3], [5, 8]], dtype=np.float32)
    total = np.asarray([[0.005, 0.005], [0.005, 0.005]], dtype=np.float32)
    lats = np.asarray([35.25, 35.0])
    lons = np.asarray([-80.25, -80.0])
    result = render_era5_frame(
        ptype,
        total,
        lats,
        lons,
        region=RegionBounds(-81, -79.5, 34.5, 35.5),
        phase_output_path=tmp_path / "phase.png",
        total_output_path=tmp_path / "total.png",
    )
    assert result.phase.width == 2
    assert result.phase.height == 2
    assert (tmp_path / "phase.png").is_file()
    assert (tmp_path / "total.png").is_file()
    with Image.open(tmp_path / "phase.png") as image:
        assert image.mode == "RGBA"


def test_era5_builder_writes_provenance_and_catalog_without_cds_download(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    start = datetime(2025, 1, 1, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    lats = np.asarray([35.25, 35.0])
    lons = np.asarray([-80.25, -80.0])
    grids = [
        Era5HourlyGrid(start + timedelta(hours=index), np.asarray([[1, 5], [7, 8]], dtype=np.float32), np.full((2, 2), 0.002, dtype=np.float32), lats, lons)
        for index in range(2)
    ]
    download_calls = 0

    def fake_download(*_args):
        nonlocal download_calls
        download_calls += 1
        return [tmp_path / "fake.grib"]

    monkeypatch.setattr("radar_processing.era5.download_era5_months", fake_download)
    monkeypatch.setattr("radar_processing.era5.load_era5_hourly_grids", lambda *_args: grids)

    def fake_loop(records, frame_dir, output, **_kwargs):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"GIF89a")
        assert all((frame_dir / Path(record["url"]).name).is_file() for record in records)
        return len(records)

    monkeypatch.setattr("radar_processing.era5.build_loop_gif", fake_loop)
    manifest = build_era5_dataset(
        root=tmp_path,
        output_root=tmp_path / "era5-output",
        start=start,
        end=end,
        bounds=RegionBounds(-81, -79.5, 34.5, 35.5),
        region_id="test-region",
        max_frames=ERA5_MAX_FRAMES,
        client=object(),
    )
    assert manifest["source"] == "era5"
    assert manifest["source_type"] == "reanalysis"
    assert manifest["observed"] is False
    assert manifest["temporal_resolution"] == "hourly"
    assert manifest["era5_reconstruction_version"] == 1
    assert manifest["product_type"] == "historical_precipitation_reconstruction"
    assert manifest["bounds"] == [-81.0, 34.5, -79.5, 35.5]
    assert len(manifest["frames"]) == 2
    assert set(manifest["products"]) == {"ERA5PrecipitationType", "ERA5TotalPrecipitation"}
    assert "not observed radar" in manifest["methodology"]

    cached = build_era5_dataset(
        root=tmp_path,
        output_root=tmp_path / "era5-output",
        start=start,
        end=end,
        bounds=RegionBounds(-81, -79.5, 34.5, 35.5),
        region_id="test-region",
        max_frames=ERA5_MAX_FRAMES,
        client=object(),
    )
    assert cached["dataset_id"] == manifest["dataset_id"]
    assert download_calls == 1
