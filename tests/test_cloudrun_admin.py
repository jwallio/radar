from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest

from cloudrun import admin_service


def test_mrms_bounds_are_normalized_and_limited_to_conus() -> None:
    bounds, region_id = admin_service._mrms_bounds(
        {
            "bounds": [-84.5, 33.5, -75.0, 37.5],
            "region_id": "North Carolina",
        }
    )

    assert bounds == [-84.5, 33.5, -75.0, 37.5]
    assert region_id == "north-carolina"

    with pytest.raises(ValueError, match="inside the CONUS"):
        admin_service._mrms_bounds({"bounds": [-140, 20, -60, 55]})


def test_era5_bounds_allow_the_atlantic_caribbean_archive_view() -> None:
    bounds, region_id = admin_service._era5_bounds(
        {
            "bounds": [-100.0, 12.0, -55.0, 52.0],
            "region_id": "Atlantic & Caribbean",
        }
    )

    assert bounds == [-100.0, 12.0, -55.0, 52.0]
    assert region_id == "atlantic-caribbean"


def test_history_job_requires_worker_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    response = admin_service.app.test_client().post(
        "/history/jobs",
        json={
            "source": "mrms",
            "start": "2026-07-27T12:00:00-04:00",
            "end": "2026-07-27T13:00:00-04:00",
        },
    )

    assert response.status_code == 401


def test_mrms_history_job_rejects_dates_before_archive_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    response = admin_service.app.test_client().post(
        "/history/jobs",
        headers={"Authorization": "Bearer service-token"},
        json={
            "source": "mrms",
            "start": "2014-11-23T18:00:00-05:00",
            "end": "2014-11-23T19:00:00-05:00",
            "bounds": [-84.5, 33.5, -75.0, 37.5],
        },
    )

    assert response.status_code == 400
    assert "2014-11-24" in response.get_json()["error"]


def test_era5_history_job_passes_hourly_bounded_overrides_and_owner_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    monkeypatch.setenv("GCP_REGION", "us-east1")
    monkeypatch.setenv("HISTORY_JOB_NAME", "wallcloud-radar-history")
    writes: list[tuple[str, dict[str, Any]]] = []
    requests: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(admin_service, "_r2_client", lambda: (object(), object()))
    monkeypatch.setattr(admin_service, "_claim_era5_job", lambda _client, _config, _job_id: None)
    monkeypatch.setattr(
        admin_service,
        "put_json_object",
        lambda _client, _config, key, payload, **_kwargs: writes.append((key, payload)),
    )
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda url, payload=None: requests.append((url, payload or {})) or {"name": "executions/era5"},
    )
    response = admin_service.app.test_client().post(
        "/history/jobs",
        headers={"Authorization": "Bearer service-token"},
        json={
            "source": "era5",
            "start": "2026-08-07T09:00:00-04:00",
            "end": "2026-08-07T12:00:00-04:00",
            "max_frames": 168,
            "bounds": [-84.5, 33.5, -75.0, 37.5],
            "region_id": "Mid Atlantic",
        },
    )

    assert response.status_code == 202
    assert writes[0][0].startswith("radar/history/era5/jobs/history-")
    environment = {
        item["name"]: item["value"]
        for item in requests[0][1]["overrides"]["containerOverrides"][0]["env"]
    }
    assert environment["HISTORY_SOURCE"] == "era5"
    assert environment["HISTORY_MAX_FRAMES"] == "168"
    assert environment["HISTORY_REGION_ID"] == "mid-atlantic"
    assert environment["ERA5_REGION_WEST"] == "-84.5"
    assert environment["ERA5_REGION_NORTH"] == "37.5"
    assert "MRMS_REGION_WEST" not in environment
    assert "MRMS_INCLUDE_PRECIP_TYPE" not in environment


def test_era5_history_job_rejects_a_second_active_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setattr(admin_service, "_r2_client", lambda: (object(), object()))
    monkeypatch.setattr(
        admin_service,
        "get_json_object_with_etag",
        lambda _client, _config, _key: (
            {
                "job_id": "history-existing",
                "status": "running",
                "updated_at": "2099-01-01T00:00:00Z",
            },
            '"etag"',
        ),
    )
    response = admin_service.app.test_client().post(
        "/history/jobs",
        headers={"Authorization": "Bearer service-token"},
        json={
            "source": "era5",
            "start": "2026-08-07T09:00:00Z",
            "end": "2026-08-07T10:00:00Z",
            "bounds": [-84.5, 33.5, -75.0, 37.5],
        },
    )

    assert response.status_code == 409
    assert "already active" in response.get_json()["error"]


def test_history_job_reuses_a_covering_catalog_range(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setattr(admin_service, "_r2_client", lambda: (object(), object()))
    monkeypatch.setattr(
        admin_service,
        "get_json_object",
        lambda _client, _config, key: {
            "datasets": [
                {
                    "id": "mrms-north-carolina-existing",
                    "start_time": "2024-09-27T00:00:00Z",
                    "end_time": "2024-09-27T03:00:00Z",
                    "region_id": "north-carolina",
                    "bounds": [-86.5, 32.5, -73.5, 39.5],
                    "manifest_url": "./mrms-north-carolina-existing/manifest.json",
                }
            ]
        } if key == "radar/history/catalog.json" else None,
    )
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda *_args, **_kwargs: pytest.fail("a covered range must not launch Cloud Run"),
    )

    response = admin_service.app.test_client().post(
        "/history/jobs",
        headers={"Authorization": "Bearer service-token"},
        json={
            "source": "mrms",
            "start": "2024-09-27T01:00:00Z",
            "end": "2024-09-27T02:00:00Z",
            "bounds": [-86.5, 32.5, -73.5, 39.5],
            "region_id": "north-carolina",
        },
    )

    assert response.status_code == 409
    assert response.get_json()["dataset_id"] == "mrms-north-carolina-existing"


def test_history_job_allows_a_range_that_extends_existing_coverage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    monkeypatch.setenv("MRMS_HISTORY_JOB_NAME", "wallcloud-radar-history")
    monkeypatch.setattr(admin_service, "_r2_client", lambda: (object(), object()))
    monkeypatch.setattr(
        admin_service,
        "get_json_object",
        lambda *_args: {
            "datasets": [
                {
                    "id": "mrms-north-carolina-existing",
                    "start_time": "2024-09-27T01:00:00Z",
                    "end_time": "2024-09-27T02:00:00Z",
                    "region_id": "north-carolina",
                    "bounds": [-86.5, 32.5, -73.5, 39.5],
                }
            ]
        },
    )
    monkeypatch.setattr(admin_service, "put_json_object", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(admin_service, "_google_post", lambda *_args, **_kwargs: {"name": "executions/new"})

    response = admin_service.app.test_client().post(
        "/history/jobs",
        headers={"Authorization": "Bearer service-token"},
        json={
            "source": "mrms",
            "start": "2024-09-27T00:00:00Z",
            "end": "2024-09-27T02:00:00Z",
            "bounds": [-86.5, 32.5, -73.5, 39.5],
            "region_id": "north-carolina",
        },
    )

    assert response.status_code == 202


def test_mrms_history_job_passes_bounded_execution_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    monkeypatch.setenv("GCP_REGION", "us-east1")
    monkeypatch.setenv("MRMS_HISTORY_JOB_NAME", "wallcloud-radar-history")
    monkeypatch.setenv("MRMS_HISTORY_MAX_HOURS", "24")
    writes: list[tuple[str, dict[str, Any]]] = []
    requests: list[tuple[str, dict[str, Any]]] = []

    monkeypatch.setattr(admin_service, "_r2_client", lambda: (object(), object()))
    monkeypatch.setattr(
        admin_service,
        "put_json_object",
        lambda _client, _config, key, payload: writes.append((key, payload)),
    )

    def fake_google_post(url: str, payload: dict[str, Any] | None = None) -> dict[str, str]:
        requests.append((url, payload or {}))
        return {"name": "projects/wall-cloud-radar/executions/example"}

    monkeypatch.setattr(admin_service, "_google_post", fake_google_post)
    response = admin_service.app.test_client().post(
        "/history/jobs",
        headers={"Authorization": "Bearer service-token"},
        json={
            "source": "mrms",
            "start": "2026-07-27T12:00:00-04:00",
            "end": "2026-07-27T13:00:00-04:00",
            "max_frames": 20,
            "bounds": [-84.5, 33.5, -75.0, 37.5],
            "region_id": "North Carolina",
        },
    )

    assert response.status_code == 202
    assert writes[0][0].startswith("radar/history/jobs/history-")
    run_url, run_payload = requests[0]
    assert run_url.endswith("/jobs/wallcloud-radar-history:run")
    environment = {
        item["name"]: item["value"]
        for item in run_payload["overrides"]["containerOverrides"][0]["env"]
    }
    assert environment["HISTORY_SOURCE"] == "mrms"
    assert environment["HISTORY_MAX_FRAMES"] == "20"
    assert environment["HISTORY_REGION_ID"] == "north-carolina"
    assert environment["MRMS_REGION_WEST"] == "-84.5"
    assert environment["MRMS_REGION_NORTH"] == "37.5"


def test_focus_control_stores_one_bounded_region_and_resumes_scheduler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    monkeypatch.setenv("GCP_REGION", "us-east1")
    monkeypatch.setenv("FOCUS_SCHEDULER_JOB", "wallcloud-focus-refresh")
    writes: list[dict[str, Any]] = []
    requests: list[str] = []
    monkeypatch.setattr(admin_service, "_read_focus_state", lambda: {"enabled": False})
    monkeypatch.setattr(admin_service, "_write_focus_state", lambda state: writes.append(state))
    monkeypatch.setattr(admin_service, "_google_get", lambda _url: {"state": "PAUSED"})
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda url, payload=None: requests.append(url) or {},
    )

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={
            "enabled": True,
            "region_id": "Southeast",
            "region_label": "Southeast",
            "bounds": [-91.5, 24.0, -74.0, 37.8],
            "duration_hours": 12,
        },
    )

    assert response.status_code == 200
    state = response.get_json()
    assert state["enabled"] is True
    assert state["region_id"] == "southeast"
    assert state["bounds"] == [-91.5, 24.0, -74.0, 37.8]
    assert datetime.fromisoformat(state["expires_at"].replace("Z", "+00:00")) > datetime.fromisoformat(
        state["updated_at"].replace("Z", "+00:00")
    )
    assert writes == [state]
    assert requests == [
        "https://cloudscheduler.googleapis.com/v1/projects/wall-cloud-radar/locations/us-east1/"
        "jobs/wallcloud-focus-refresh:resume"
    ]


def test_focus_control_requires_worker_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")

    response = admin_service.app.test_client().post(
        "/control/focus",
        json={"enabled": False},
    )

    assert response.status_code == 401


def test_focus_control_switches_region_without_resuming_an_enabled_scheduler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    writes: list[dict[str, Any]] = []
    monkeypatch.setattr(
        admin_service,
        "_read_focus_state",
        lambda: {
            "enabled": True,
            "updated_at": "2026-07-28T12:00:00Z",
            "expires_at": "2099-07-29T00:00:00Z",
            "region_id": "southeast",
            "region_label": "Southeast",
            "bounds": [-91.5, 24.0, -74.0, 37.8],
        },
    )
    monkeypatch.setattr(admin_service, "_write_focus_state", lambda state: writes.append(state))
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda *_args, **_kwargs: pytest.fail("enabled Scheduler should not be resumed"),
    )

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={
            "enabled": True,
            "region_id": "central-plains",
            "region_label": "Central Plains",
            "bounds": [-106.0, 34.0, -90.0, 49.0],
        },
    )

    assert response.status_code == 200
    assert writes[-1]["region_id"] == "central-plains"


def test_focus_control_rejects_conus_sized_regions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setattr(admin_service, "_read_focus_state", lambda: {"enabled": False})

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={
            "enabled": True,
            "region_id": "conus",
            "region_label": "Continental U.S.",
            "bounds": [-130.0, 20.0, -60.0, 55.0],
        },
    )

    assert response.status_code == 400
    assert "limited to" in response.get_json()["error"]


def test_focus_control_rejects_fractional_duration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setattr(admin_service, "_read_focus_state", lambda: {"enabled": False})

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={
            "enabled": True,
            "region_id": "southeast",
            "bounds": [-91.5, 24.0, -74.0, 37.8],
            "duration_hours": 1.5,
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "duration_hours must be an integer"


def test_focus_control_pauses_scheduler_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    monkeypatch.setenv("GCP_REGION", "us-east1")
    writes: list[dict[str, Any]] = []
    requests: list[str] = []
    monkeypatch.setattr(
        admin_service,
        "_read_focus_state",
        lambda: {
            "enabled": True,
            "expires_at": "2099-07-29T00:00:00Z",
            "region_id": "southeast",
            "region_label": "Southeast",
            "bounds": [-91.5, 24.0, -74.0, 37.8],
        },
    )
    monkeypatch.setattr(admin_service, "_write_focus_state", lambda state: writes.append(state))
    monkeypatch.setattr(admin_service, "_google_get", lambda _url: {"state": "ENABLED"})
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda url, payload=None: requests.append(url) or {},
    )

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={"enabled": False},
    )

    assert response.status_code == 200
    assert writes[-1]["enabled"] is False
    assert requests[0].endswith("/jobs/wallcloud-focus-refresh:pause")


def test_focus_control_resumes_after_an_expired_enabled_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    writes: list[dict[str, Any]] = []
    requests: list[str] = []
    monkeypatch.setattr(
        admin_service,
        "_read_focus_state",
        lambda: {
            "enabled": True,
            "expires_at": "2020-01-01T00:00:00Z",
            "region_id": "old-region",
            "region_label": "Old Region",
            "bounds": [-90.0, 30.0, -80.0, 40.0],
        },
    )
    monkeypatch.setattr(admin_service, "_write_focus_state", lambda state: writes.append(state))
    monkeypatch.setattr(admin_service, "_google_get", lambda _url: {"state": "PAUSED"})
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda url, payload=None: requests.append(url) or {},
    )

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={
            "enabled": True,
            "region_id": "central-plains",
            "region_label": "Central Plains",
            "bounds": [-106.0, 34.0, -90.0, 49.0],
        },
    )

    assert response.status_code == 200
    assert writes[-1]["region_id"] == "central-plains"
    assert requests == [
        "https://cloudscheduler.googleapis.com/v1/projects/wall-cloud-radar/locations/us-east1/"
        "jobs/wallcloud-focus-refresh:resume"
    ]


def test_focus_control_disables_an_already_paused_expired_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_SERVICE_TOKEN", "service-token")
    monkeypatch.setenv("GCP_PROJECT_ID", "wall-cloud-radar")
    writes: list[dict[str, Any]] = []
    monkeypatch.setattr(
        admin_service,
        "_read_focus_state",
        lambda: {
            "enabled": True,
            "expires_at": "2020-01-01T00:00:00Z",
            "region_id": "old-region",
            "region_label": "Old Region",
            "bounds": [-90.0, 30.0, -80.0, 40.0],
        },
    )
    monkeypatch.setattr(admin_service, "_write_focus_state", lambda state: writes.append(state))
    monkeypatch.setattr(admin_service, "_google_get", lambda _url: {"state": "PAUSED"})
    monkeypatch.setattr(
        admin_service,
        "_google_post",
        lambda *_args, **_kwargs: pytest.fail("an already-paused Scheduler should not be paused again"),
    )

    response = admin_service.app.test_client().post(
        "/control/focus",
        headers={"Authorization": "Bearer service-token"},
        json={"enabled": False},
    )

    assert response.status_code == 200
    assert writes == [response.get_json()]
    assert writes[0]["enabled"] is False
