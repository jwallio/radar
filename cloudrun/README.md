# Cloud Run Jobs deployment

This is the production ingestion path for the historical-first viewer. The image contains the existing Py-ART KRAX renderer, R2 publisher, and a small scale-to-zero administrator service.

## Components

- `wallcloud-krax-history` — on-demand historical KRAX Level II job.
- `wallcloud-radar-live` — one KRAX refresh execution; Cloud Scheduler invokes it every five minutes only while the scheduler is resumed.
- `wallcloud-radar-admin` — authenticated Cloud Run service that starts historical jobs and pauses/resumes the live Scheduler job.
- `wallcloud-live-refresh` — paused-by-default Cloud Scheduler job targeting the Cloud Run Jobs API.

Cloud Run Jobs are batch executions, not HTTP servers. The Scheduler target calls the authenticated Cloud Run Jobs `:run` API. Historical requests use per-execution environment overrides for the Eastern Time start/end values.

## One-time Google Cloud setup

Use a Google Cloud project with billing enabled. The default region below is `us-east1`, which is close to North Carolina.

```powershell
$project = "YOUR_GCP_PROJECT_ID"
$region = "us-east1"
gcloud auth login
gcloud config set project $project
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create wallcloud --repository-format=docker --location=$region --description="Wall Cloud radar images"
```

Create a dedicated service account. It needs only the permissions required to run the two jobs and pause/resume the one Scheduler job. A project-level custom role is preferable to broad administrator roles:

```powershell
$serviceAccount = "wallcloud-radar-control@$project.iam.gserviceaccount.com"
gcloud iam service-accounts create wallcloud-radar-control --display-name="Wall Cloud radar control"
gcloud iam roles create wallcloudRadarControl --project=$project --title="Wall Cloud radar control" --permissions="cloudscheduler.jobs.pause,cloudscheduler.jobs.enable,run.jobs.run" --stage=GA
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="projects/$project/roles/wallcloudRadarControl"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$serviceAccount" --role="roles/secretmanager.secretAccessor"
```

Store these values in Secret Manager. Do not put them in this repository, GitHub variables, or public frontend configuration:

- `wallcloud-r2-access-key`
- `wallcloud-r2-secret-key`
- `wallcloud-admin-token`

The first two are the scoped Cloudflare R2 Object Read & Write credentials. The admin token is a separate random value used only between the Cloudflare Worker and the Cloud Run admin service.

## Build the image

From the repository root:

```powershell
$image = "$region-docker.pkg.dev/$project/wallcloud/radar:latest"
gcloud builds submit --tag $image --file Dockerfile.cloudrun .
```

## Create the historical job

```powershell
gcloud run jobs deploy wallcloud-krax-history `
  --image $image `
  --region $region `
  --service-account $serviceAccount `
  --cpu 2 --memory 4Gi --task-timeout 60m --max-retries 0 `
  --command python `
  --args scripts/run_cloud_run_historical.py `
  --set-env-vars R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com,R2_BUCKET=wallcloud-radar-data,HISTORY_SOURCE=krax `
  --set-secrets R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest
```

The `--set-env-vars` line should be supplied as separate comma-delimited key/value pairs. Replace the example with the actual R2 endpoint and bucket. A manual test uses execution overrides:

```powershell
gcloud run jobs execute wallcloud-krax-history `
  --region $region `
  --update-env-vars HISTORY_SOURCE=krax,HISTORY_START=2026-07-25T18:00:00-04:00,HISTORY_END=2026-07-25T20:00:00-04:00,HISTORY_MAX_FRAMES=30,HISTORY_JOB_ID=history-manual-test
```

## Create the live job and paused Scheduler

```powershell
gcloud run jobs deploy wallcloud-radar-live `
  --image $image `
  --region $region `
  --service-account $serviceAccount `
  --cpu 2 --memory 4Gi --task-timeout 25m --max-retries 0 `
  --command python `
  --args scripts/run_cloud_run_live.py `
  --set-env-vars R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com,R2_BUCKET=wallcloud-radar-data,R2_RETAIN_DAYS=3,RADAR_CONTROL_STATUS_URL=https://wallcloud-radar-control.jlwall33.workers.dev/control/status,NEXRAD_SITE=KRAX,NEXRAD_MAX_FRAMES=12,NEXRAD_RETENTION_MINUTES=90 `
  --set-secrets R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest

$runApi = "https://run.googleapis.com/v2/projects/$project/locations/$region/jobs/wallcloud-radar-live:run"
gcloud scheduler jobs create http wallcloud-live-refresh `
  --location $region `
  --schedule "*/5 * * * *" `
  --uri $runApi `
  --http-method POST `
  --headers "Content-Type=application/json" `
  --oauth-service-account-email $serviceAccount `
  --oauth-token-scope https://www.googleapis.com/auth/cloud-platform `
  --message-body '{}'
gcloud scheduler jobs pause wallcloud-live-refresh --location $region
```

The final pause is intentional. The site is archive-first until an administrator turns live mode on.

## Deploy the administrator service

```powershell
gcloud run deploy wallcloud-radar-admin `
  --image $image `
  --region $region `
  --service-account $serviceAccount `
  --allow-unauthenticated `
  --command gunicorn `
  --args "--bind=:8080,cloudrun.admin_service:app" `
  --set-env-vars GCP_PROJECT_ID=$project,GCP_REGION=$region,LIVE_SCHEDULER_JOB=wallcloud-live-refresh,HISTORY_JOB_NAME=wallcloud-krax-history,HISTORY_MAX_HOURS=6,R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com,R2_BUCKET=wallcloud-radar-data `
  --set-secrets ADMIN_SERVICE_TOKEN=wallcloud-admin-token:latest,R2_ACCESS_KEY_ID=wallcloud-r2-access-key:latest,R2_SECRET_ACCESS_KEY=wallcloud-r2-secret-key:latest
```

Copy the service URL into the Cloudflare Worker as `ADMIN_SERVICE_URL`, and set the Worker secret `ADMIN_SERVICE_TOKEN` to the same value stored in Secret Manager. Redeploy the Worker. The public site continues to use only the Worker URL and the administrator enters the existing `POLLING_CONTROL_TOKEN` in the browser.

## Test and operate

```powershell
gcloud run jobs execute wallcloud-radar-live --region $region
gcloud run jobs executions list --job wallcloud-radar-live --region $region
gcloud logging read "resource.type=cloud_run_job" --limit 20 --project $project
gcloud scheduler jobs describe wallcloud-live-refresh --location $region
```

Keep the live Scheduler paused except during an active severe-weather window. Cloud Run bills job instances for their execution lifetime with a one-minute minimum, so pausing the Scheduler is the cost guardrail.
