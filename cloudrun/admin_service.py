from __future__ import annotations

import hmac
import os
import re
import uuid
from datetime import timedelta
from urllib.parse import quote

import google.auth
import requests
from flask import Flask, jsonify, request
from google.auth.transport.requests import Request as GoogleAuthRequest

from radar_processing.history import parse_timestamp
from radar_processing.r2 import R2PublishConfig, create_r2_client, get_json_object, put_json_object


app = Flask(__name__)
JOB_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,62}$")
GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


def _authorized() -> bool:
    expected = os.getenv("ADMIN_SERVICE_TOKEN", "").strip()
    received = request.headers.get("Authorization", "")
    return bool(expected) and hmac.compare_digest(received, f"Bearer {expected}")


def _require_auth():
    if not _authorized():
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _google_post(url: str, payload: dict | None = None) -> dict:
    credentials, _ = google.auth.default(scopes=[GOOGLE_SCOPE])
    credentials.refresh(GoogleAuthRequest())
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {credentials.token}", "Content-Type": "application/json"},
        json=payload or {},
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Google API returned HTTP {response.status_code}: {response.text[:500]}")
    return response.json() if response.content else {}


def _project() -> str:
    value = os.getenv("GCP_PROJECT_ID", "").strip()
    if not value:
        raise RuntimeError("GCP_PROJECT_ID is not configured")
    return value


def _region() -> str:
    return os.getenv("GCP_REGION", "us-east1").strip()


def _scheduler_url(action: str) -> str:
    job = os.getenv("LIVE_SCHEDULER_JOB", "wallcloud-live-refresh").strip()
    name = f"projects/{_project()}/locations/{_region()}/jobs/{job}"
    return f"https://cloudscheduler.googleapis.com/v1/{name}:{action}"


def _run_job_url(job_name: str) -> str:
    encoded = quote(job_name, safe="")
    return f"https://run.googleapis.com/v2/projects/{_project()}/locations/{_region()}/jobs/{encoded}:run"


def _r2_client():
    config = R2PublishConfig.from_env()
    return create_r2_client(config), config


def _write_polling_state(enabled: bool) -> None:
    client, config = _r2_client()
    from datetime import datetime, timezone

    put_json_object(
        client,
        config,
        "control/polling.json",
        {"enabled": enabled, "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
    )


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True, "service": "wallcloud-radar-admin"})


@app.post("/control/live")
def control_live():
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        return jsonify({"error": "enabled must be a boolean"}), 400
    try:
        if enabled:
            # Publish the gate before resuming so the first scheduled execution
            # cannot observe the old disabled state and exit unnecessarily.
            _write_polling_state(True)
            try:
                _google_post(_scheduler_url("resume"))
            except Exception:
                _write_polling_state(False)
                raise
        else:
            _google_post(_scheduler_url("pause"))
            _write_polling_state(False)
        return jsonify({"enabled": enabled})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.post("/history/jobs")
def start_history_job():
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    if payload.get("source", "krax") != "krax":
        return jsonify({"error": "Only KRAX historical jobs are enabled"}), 400
    try:
        start = parse_timestamp(str(payload["start"]))
        end = parse_timestamp(str(payload["end"]))
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid historical timestamps: {exc}"}), 400
    if start >= end:
        return jsonify({"error": "start must be before end"}), 400
    max_hours = max(1, int(os.getenv("HISTORY_MAX_HOURS", "6")))
    if end - start > timedelta(hours=max_hours):
        return jsonify({"error": f"Historical range is limited to {max_hours} hours"}), 400
    try:
        max_frames = max(1, min(90, int(payload.get("max_frames", 30))))
    except (TypeError, ValueError):
        return jsonify({"error": "max_frames must be an integer"}), 400
    job_id = f"history-{uuid.uuid4().hex[:16]}"
    if not JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Unable to create a valid job id"}), 500
    client, config = _r2_client()
    put_json_object(
        client,
        config,
        f"radar/krax/history/jobs/{job_id}.json",
        {"job_id": job_id, "status": "pending", "source": "krax", "start": start.isoformat(), "end": end.isoformat()},
    )
    job_name = os.getenv("HISTORY_JOB_NAME", "wallcloud-krax-history").strip()
    try:
        execution = _google_post(
            _run_job_url(job_name),
            {
                "overrides": {
                    "containerOverrides": [
                        {
                            "env": [
                                {"name": "HISTORY_SOURCE", "value": "krax"},
                                {"name": "HISTORY_START", "value": start.isoformat()},
                                {"name": "HISTORY_END", "value": end.isoformat()},
                                {"name": "HISTORY_MAX_FRAMES", "value": str(max_frames)},
                                {"name": "HISTORY_JOB_ID", "value": job_id},
                            ]
                        }
                    ]
                }
            },
        )
    except Exception as exc:
        put_json_object(client, config, f"radar/krax/history/jobs/{job_id}.json", {"job_id": job_id, "status": "failed", "message": str(exc)})
        return jsonify({"error": str(exc)}), 502
    return jsonify({"job_id": job_id, "status": "running", "execution": execution.get("name")}), 202


@app.get("/history/jobs/<job_id>")
def history_job_status(job_id: str):
    unauthorized = _require_auth()
    if unauthorized:
        return unauthorized
    if not JOB_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "Invalid job id"}), 400
    try:
        client, config = _r2_client()
        payload = get_json_object(client, config, f"radar/krax/history/jobs/{job_id}.json")
        if payload is None:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
