# Cloud Run production radar

Cloud Run Jobs process public-requested MRMS/ERA5 history and owner-requested KRAX history, then publish browser-ready assets to Cloudflare R2. MRMS history begins on 2014-11-24; packs beginning on 2020-10-14 request the full configured product suite. The near-zero idle default uses GitHub Pages for the Vite archive application.

## Production components

- `.github/workflows/national-radar-refresh.yml` — five-minute national MRMS publisher; the near-zero default.
- `wallcloud-mrms-live` — optional managed fallback for the public national MRMS mosaic.
- `wallcloud-mrms-refresh` — optional five-minute Scheduler trigger; absent or paused in the near-zero profile.
- `wallcloud-mrms-focus` — higher-detail regional MRMS job for the one region selected by the owner.
- `wallcloud-focus-refresh` — five-minute focus trigger; paused unless storm focus is active and automatically paused at expiry.
- `wallcloud-radar-history` — on-demand regional MRMS, KRAX, or ERA5 historical processing; MRMS declares a core/full product tier by start date, while public ERA5 is cache-first and serialized to one active request.
- `wallcloud-radar-live` — KRAX Level II refresh; enabled only during severe weather.
- `wallcloud-live-refresh` — five-minute KRAX trigger; paused by default.
- `wallcloud-radar-admin` — scale-to-zero service that starts history jobs and controls the focus and KRAX Schedulers.
- Cloudflare Worker — browser-facing proxy. MRMS/ERA5 history is public; KRAX history and either live polling mode require the owner key. The Worker-to-Cloud-Run service token remains private and required.

National and storm-focus reflectivity are stored as one PMTiles archive per observation. Regional historical requests use cropped image frames and branded GIFs. ERA5 requests use the official CDS `precipitation_type` and `total_precipitation` variables at exact hourly intervals, with no dBZ conversion or five-minute interpolation. Raw GRIB2 and Level II files remain temporary.

## Variables used below

PowerShell:

```powershell
$project = "wall-cloud-radar"
$region = "us-east1"
$serviceAccount = "wallcloud-radar-control@$project.iam.gserviceaccount.com"
$image = "$region-docker.pkg.dev/$project/wallcloud/radar:latest"
$r2Endpoint = "https://ACCOUNT_ID.r2.cloudflarestorage.com"
$r2Bucket = "wallcloud-radar-data"
gcloud config set project $project
```

Cloud Shell:

```bash
export PROJECT_ID=wall-cloud-radar
export REGION=us-east1
export SERVICE_ACCOUNT="wallcloud-radar-control@$PROJECT_ID.iam.gserviceaccount.com"
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/wallcloud/radar:latest"
export R2_ENDPOINT_URL="https://ACCOUNT_ID.r2.cloudflarestorage.com"
export R2_BUCKET="wallcloud-radar-data"
gcloud config set project "$PROJECT_ID"
```

Replace only `ACCOUNT_ID` if the other names match the deployed project.

## One-time APIs, repository, and identity

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com iam.googleapis.com
gcloud artifacts repositories describe wallcloud --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create wallcloud --repository-format=docker --location="$REGION" --description="Wall Cloud radar images"
```

The service account needs job execution, per-execution environment overrides, Scheduler state reads, Scheduler pause/enable, and secret access. `enable` is the IAM permission used to resume a paused Scheduler job.

```bash
gcloud iam roles update wallcloudRadarControl \
  --project="$PROJECT_ID" \
  --title="Wall Cloud radar control" \
  --permissions="cloudscheduler.jobs.get,cloudscheduler.jobs.pause,cloudscheduler.jobs.enable,run.jobs.run,run.jobs.runWithOverrides" \
  --stage=GA

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="projects/$PROJECT_ID/roles/wallcloudRadarControl" \
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None
```

Secret Manager must contain:

- `wallcloud-r2-access-key`
- `wallcloud-r2-secret-key`
- `wallcloud-admin-token`
- `wallcloud-cds-api-key`

The R2 credentials need Object Read & Write for only the radar bucket. The CDS token is used only by the Cloud Run history job. Never expose any of these secrets through a `VITE_*` variable.

Create or rotate the CDS secret from a local file that is outside the repository (the file contains the personal access token copied from the CDS profile):

```bash
gcloud secrets describe wallcloud-cds-api-key --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud secrets create wallcloud-cds-api-key --project="$PROJECT_ID" --replication-policy=automatic
gcloud secrets versions add wallcloud-cds-api-key --project="$PROJECT_ID" --data-file="$HOME/cds-api-key.txt"
```

The shared history job receives this secret as `CDSAPI_KEY`. The default `CDSAPI_URL` is the current official `https://cds.climate.copernicus.eu/api`; set a `CDSAPI_URL` environment override only when the official client documentation requires a service-endpoint change.

## Build the container

```bash
gcloud builds submit \
  --project="$PROJECT_ID" \
  --config=cloudbuild.yaml \
  --substitutions="_IMAGE=$IMAGE" \
  .
```

The image includes ecCodes/cfgrib, Py-ART, rasterio, rio-pmtiles, and the official `cdsapi` client.

## Optional managed national MRMS fallback

Skip this section for the near-zero profile. The GitHub Actions workflow runs the same publisher with a smaller dependency set and writes to the same R2 contract. Use this Cloud Run job and Scheduler only if managed scheduling is worth the recurring compute charge.

```bash
gcloud run jobs deploy wallcloud-mrms-live \
  --project="$PROJECT_ID" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --cpu=2 --memory=4Gi --task-timeout=25m --max-retries=1 \
  --command=python \
  --args=scripts/run_cloud_run_mrms_live.py \
  --set-env-vars="R2_ENDPOINT_URL=$R2_ENDPOINT_URL,R2_BUCKET=$R2_BUCKET,R2_RETAIN_DAYS=1,MRMS_MAX_FRAMES=30,MRMS_RETENTION_MINUTES=90,MRMS_TILE_MIN_ZOOM=3,MRMS_TILE_MAX_ZOOM=8,MRMS_TILE_WORKERS=2" \
  --set-secrets="R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest"

export MRMS_RUN_API="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/wallcloud-mrms-live:run"
gcloud scheduler jobs describe wallcloud-mrms-refresh --location="$REGION" >/dev/null 2>&1 &&
  gcloud scheduler jobs update http wallcloud-mrms-refresh \
    --location="$REGION" --schedule="*/5 * * * *" --uri="$MRMS_RUN_API" \
    --http-method=POST --headers="Content-Type=application/json" \
    --oauth-service-account-email="$SERVICE_ACCOUNT" \
    --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" --message-body="{}" ||
  gcloud scheduler jobs create http wallcloud-mrms-refresh \
    --location="$REGION" --schedule="*/5 * * * *" --uri="$MRMS_RUN_API" \
    --http-method=POST --headers="Content-Type=application/json" \
    --oauth-service-account-email="$SERVICE_ACCOUNT" \
    --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" --message-body="{}"
```

If this fallback was deployed previously but GitHub Actions is now the primary publisher, pause it to avoid duplicate processing:

```bash
gcloud scheduler jobs pause wallcloud-mrms-refresh --location="$REGION"
```

## Deploy the owner-selected MRMS storm-focus job

This job is the managed five-minute path worth keeping: it renders only one selected regional preset, uses zoom levels 4–10, and is paused whenever no focus is active. The owner control stores one region in `control/focus.json`; selecting another region replaces it rather than creating parallel jobs. Each activation lasts 12 hours by default, and the job pauses its own Scheduler when that expiration is reached.

On a new region or after a long gap, the first execution publishes only the newest frame. Later five-minute executions grow the rolling loop incrementally. This keeps the first result fast and prevents a large bootstrap from overlapping the next scheduled execution. Before publication, the job rechecks the focus object version; an older in-flight execution cannot publish or disable a newer region selection.

```bash
gcloud run jobs deploy wallcloud-mrms-focus \
  --project="$PROJECT_ID" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --cpu=2 --memory=4Gi --task-timeout=25m --max-retries=0 \
  --command=python \
  --args=scripts/run_cloud_run_mrms_focus.py \
  --set-env-vars="GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,FOCUS_SCHEDULER_JOB=wallcloud-focus-refresh,FOCUS_CONTROL_OBJECT_KEY=control/focus.json,R2_ENDPOINT_URL=$R2_ENDPOINT_URL,R2_BUCKET=$R2_BUCKET,R2_RETAIN_DAYS=1,MRMS_MAX_FRAMES=30,MRMS_RETENTION_MINUTES=90,MRMS_FOCUS_TILE_MIN_ZOOM=4,MRMS_FOCUS_TILE_MAX_ZOOM=10,MRMS_TILE_WORKERS=2" \
  --set-secrets="R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest"

export FOCUS_RUN_API="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/wallcloud-mrms-focus:run"
gcloud scheduler jobs describe wallcloud-focus-refresh --location="$REGION" >/dev/null 2>&1 ||
  gcloud scheduler jobs create http wallcloud-focus-refresh \
    --location="$REGION" --schedule="*/5 * * * *" --uri="$FOCUS_RUN_API" \
    --http-method=POST --headers="Content-Type=application/json" \
    --oauth-service-account-email="$SERVICE_ACCOUNT" \
    --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" --message-body="{}"
gcloud scheduler jobs pause wallcloud-focus-refresh --location="$REGION"
```

The final pause is intentional. Do not manually resume this Scheduler for normal operations; activate a region from the website with the owner key so the R2 state and Scheduler cannot drift apart.

## Deploy the shared historical job

```bash
gcloud run jobs deploy wallcloud-radar-history \
  --project="$PROJECT_ID" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --cpu=2 --memory=4Gi --task-timeout=60m --max-retries=0 \
  --command=python \
  --args=scripts/run_cloud_run_historical.py \
  --set-env-vars="R2_ENDPOINT_URL=$R2_ENDPOINT_URL,R2_BUCKET=$R2_BUCKET,HISTORY_SOURCE=mrms,ERA5_HISTORY_MAX_HOURS=168,ERA5_ACTIVE_LOCK_KEY=radar/history/era5/active.json" \
  --set-secrets="R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest,CDSAPI_KEY=wallcloud-cds-api-key:latest"
```

The admin service supplies source, Eastern Time range, frame limit, and source-specific crop bounds as execution overrides. ERA5 requests must be whole UTC hours, no more than seven days/168 frames, no later than the available CDS data, and inside the ERA5 processing domain `[-130, 10, -55, 55]`; the Atlantic & Caribbean preset uses `[-100, 12, -55, 52]`. The job writes to `radar/history/era5/`, reuses a complete version-matched manifest when possible, and reports `Requesting ERA5`, `Downloading reanalysis`, `Processing precipitation type`, `Rendering frames`, `Uploading`, and `Complete` stages.

## Deploy the admin-only Level II job

```bash
gcloud run jobs deploy wallcloud-radar-live \
  --project="$PROJECT_ID" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --cpu=2 --memory=4Gi --task-timeout=25m --max-retries=0 \
  --command=python \
  --args=scripts/run_cloud_run_live.py \
  --set-env-vars="R2_ENDPOINT_URL=$R2_ENDPOINT_URL,R2_BUCKET=$R2_BUCKET,R2_RETAIN_DAYS=1,NEXRAD_SITE=KRAX,NEXRAD_MAX_FRAMES=18,NEXRAD_RETENTION_MINUTES=90" \
  --set-secrets="R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest"

export LEVEL2_RUN_API="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/wallcloud-radar-live:run"
gcloud scheduler jobs describe wallcloud-live-refresh --location="$REGION" >/dev/null 2>&1 ||
  gcloud scheduler jobs create http wallcloud-live-refresh \
    --location="$REGION" --schedule="*/5 * * * *" --uri="$LEVEL2_RUN_API" \
    --http-method=POST --headers="Content-Type=application/json" \
    --oauth-service-account-email="$SERVICE_ACCOUNT" \
    --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" --message-body="{}"
gcloud scheduler jobs pause wallcloud-live-refresh --location="$REGION"
```

The final pause is intentional.

## Deploy the administrator service

```bash
gcloud run deploy wallcloud-radar-admin \
  --project="$PROJECT_ID" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --cpu=1 --memory=512Mi --min-instances=0 --max-instances=2 --timeout=60s \
  --command=gunicorn \
  --args="--bind=:8080,cloudrun.admin_service:app" \
  --set-env-vars="GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,LIVE_SCHEDULER_JOB=wallcloud-live-refresh,FOCUS_SCHEDULER_JOB=wallcloud-focus-refresh,FOCUS_CONTROL_OBJECT_KEY=control/focus.json,FOCUS_MAX_HOURS=24,HISTORY_JOB_NAME=wallcloud-radar-history,MRMS_HISTORY_JOB_NAME=wallcloud-radar-history,HISTORY_MAX_HOURS=6,MRMS_HISTORY_MAX_HOURS=24,ERA5_HISTORY_MAX_HOURS=168,ERA5_ACTIVE_LOCK_KEY=radar/history/era5/active.json,R2_ENDPOINT_URL=$R2_ENDPOINT_URL,R2_BUCKET=$R2_BUCKET" \
  --set-secrets="ADMIN_SERVICE_TOKEN=wallcloud-admin-token:latest,R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest"

export ADMIN_SERVICE_URL="$(gcloud run services describe wallcloud-radar-admin --region="$REGION" --format='value(status.url)')"
curl "$ADMIN_SERVICE_URL/health"
```

Expected response:

```json
{"ok":true,"service":"wallcloud-radar-admin"}
```

Set this URL as `ADMIN_SERVICE_URL` in `control_worker/wrangler.jsonc`, set the Worker `ADMIN_SERVICE_TOKEN` secret to the same value as Secret Manager, and redeploy the Worker.

## Smoke tests and operations

```bash
gcloud scheduler jobs describe wallcloud-live-refresh --location="$REGION"
gcloud scheduler jobs describe wallcloud-focus-refresh --location="$REGION"
gcloud run services logs read wallcloud-radar-admin --region="$REGION" --limit=50
```

For the near-zero national path, manually dispatch `Refresh national MRMS radar` in GitHub Actions and verify `radar/manifest.json` in R2. If the optional managed fallback is in use, also run:

```bash
gcloud run jobs execute wallcloud-mrms-live --region="$REGION" --wait
gcloud run jobs executions list --job=wallcloud-mrms-live --region="$REGION" --limit=5
gcloud scheduler jobs describe wallcloud-mrms-refresh --location="$REGION"
```

R2 should then contain:

```text
radar/manifest.json
radar/national/frames/*.pmtiles
radar/national/previews/*.webp
radar/focus/manifest.json
radar/focus/frames/*.pmtiles
radar/focus/previews/*.webp
radar/history/catalog.json
radar/history/era5/catalog.json
radar/history/era5/{dataset_id}/manifest.json
radar/krax/manifest.json
radar/krax/history/catalog.json
```

MRMS and ERA5 historical jobs can be started publicly from the website; KRAX still requires the owner key. Legacy focus and live controls remain documented for migration compatibility. Cloud Run enforces a 24-hour MRMS historical range, rejects MRMS starts before 2014-11-24, requests the full MRMS suite only from 2020-10-14 onward, and allows at most 90 historical frames. MRMS observed crops stay inside the CONUS grid; the broader Caribbean/Atlantic map context is supported by ERA5, which is capped at seven days/168 hourly frames and one active request. Public uncached requests can produce variable Cloud Run, CDS, Worker, and R2 usage charges.
