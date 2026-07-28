# wall.cloud Radar

wall.cloud Radar is a national operational radar viewer and regional historical GIF maker for [radar.wall.cloud](https://radar.wall.cloud). The public default is the official NOAA/NCEP MRMS quality-controlled CONUS composite. An administrator can temporarily activate one higher-detail MRMS storm-focus region, while KRAX NEXRAD Level II remains available for archive work and optional live polling.

The browser never downloads or decodes GRIB2 or Level II files.

## Features

- National MRMS composite reflectivity delivered as compact PMTiles raster archives.
- One administrator-selected regional MRMS storm focus at zoom 10, refreshed every five minutes and automatically expired after 12 hours.
- Map presets for CONUS and major U.S. regions, plus current-view regional exports.
- Exact observed-frame animation, timeline scrubbing, previous/next, and 2/4/8/20/30 FPS playback.
- Adjacent PMTiles preloading to reduce frame-change flashing.
- Owner-triggered regional MRMS and KRAX historical jobs using Eastern Time date controls.
- Branded current-view GIF downloads.
- Active NWS Tornado, Severe Thunderstorm, Flash Flood, and Special Marine warning polygons.
- National state boundaries, zoom-dependent counties, major cities, and on-demand highways.
- Radar and storm-layer opacity control.
- Graceful missing, stale, unavailable, and source-fallback states.
- Mobile controls with rotation and map pitch disabled.

## Architecture

```text
Official NOAA/NCEP MRMS live directory
                  |
                  v
    GitHub Actions national job
       cfgrib/ecCodes + rasterio
                  |
                  v
  one PMTiles archive + preview per frame
                  |
                  v
        Cloudflare R2 custom domain
                  |
                  v
  GitHub Pages + Vite + MapLibre + PMTiles

Historical selection in browser
                  |
                  v
   Cloudflare Worker (owner-authorized)
                  |
                  v
    scale-to-zero Cloud Run admin service
        |                         |
        v                         v
regional history job      selected storm-focus job
        |                         |
        +------------+------------+
                     v
      frames / PMTiles + manifests in R2
```

Responsibilities are intentionally split:

- GitHub Actions publishes the continuously refreshed national MRMS sequence; GitHub Pages publishes only static application code.
- Cloud Run downloads and decodes owner-requested history, optional KRAX live data, and only the single storm-focus region selected by the owner, then scales to zero.
- R2 stores generated browser assets and atomic manifests.
- The Worker hides the Cloud Run service token and requires the owner key before starting billable work.
- MapLibre renders the basemap, boundaries, labels, warnings, and radar overlays.

This prevents a Pages deployment from replacing fresh radar with repository fixtures.

## Official data and attribution

Radar data is sourced only from official NOAA/NCEP or NOAA-hosted public datasets:

- [MRMS operational products](https://mrms.ncep.noaa.gov/2D/)
- [MergedReflectivityQCComposite](https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/)
- [PrecipFlag](https://mrms.ncep.noaa.gov/2D/PrecipFlag/)
- [NOAA MRMS archive on the Registry of Open Data on AWS](https://registry.opendata.aws/noaa-mrms-pds/)
- [NOAA NEXRAD Level II archive](https://registry.opendata.aws/noaa-nexrad/)
- [NWS API](https://www.weather.gov/documentation/services-web-api) for active warning geometry
- [NOAA NDBC](https://www.ndbc.noaa.gov/) for buoy observations

The viewer and generated share graphics include NOAA/NWS attribution where appropriate. wall.cloud is not an official government warning service; users should consult official NWS products for safety decisions.

## Radar products

Public national live mode currently publishes:

- `MergedReflectivityQCComposite`

Regional MRMS processing also supports the existing product architecture for:

- `PrecipFlag`
- one-hour multi-sensor QPE
- low- and mid-level azimuthal shear
- 30-minute rotation tracks
- MESH and POSH
- NLDN cloud-to-ground lightning density

National tiled generation for those secondary MRMS fields is intentionally disabled until each field has its own tested tiling, legend, and retention policy. The UI labels unavailable products instead of fabricating output.

KRAX Level II supports:

- Base Reflectivity
- Radial Velocity
- Correlation Coefficient

Level II is single-site radar data, not a replacement for the quality-controlled national MRMS mosaic.

## Local setup — Windows PowerShell

Frontend:

```powershell
cd D:\weather-projects\wallcloud-weather-dashboard
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). To make the local frontend read production R2 data, create an untracked `.env.local`:

```text
VITE_RADAR_DATA_BASE_URL=https://data.radar.wall.cloud
VITE_RADAR_CONTROL_API_URL=https://wallcloud-radar-control.jlwall33.workers.dev
```

Restart `npm run dev` after changing an environment file.

Python 3.12 virtual environment:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-cloudrun.txt -r requirements-dev.txt
```

`requirements-cloudrun.txt` includes:

- cfgrib and ecCodes for MRMS GRIB2
- Py-ART, SciPy, and pyproj for Level II
- rasterio and rio-pmtiles for national tiles
- boto3 for R2
- Flask, gunicorn, and google-auth for Cloud Run control

On Windows, a fresh isolated Python environment is strongly preferred over mixing binary NumPy/SciPy packages into an existing Conda base environment.

## Generate current national MRMS locally

One validation frame:

```powershell
python scripts/build_national_mrms.py `
  --max-frames 1 `
  --retention-minutes 10 `
  --min-zoom 3 `
  --max-zoom 8 `
  --workers 2
```

Normal recent sequence:

```powershell
$env:MRMS_MAX_FRAMES = '30'
$env:MRMS_RETENTION_MINUTES = '90'
python scripts/build_national_mrms.py
```

Output:

```text
public/data/radar/manifest.json
public/data/radar/national/frames/*.pmtiles
public/data/radar/national/previews/*.webp
```

Use `--output-dir .radar-tmp\national-validation` to validate without changing the tracked placeholder manifest.

The official operational directory is centralized through `MRMS_BASE_URL`; the default is `https://mrms.ncep.noaa.gov/2D`. Network requests use timeouts and retries. Raw GRIB2 files stay in temporary storage unless raw retention is explicitly enabled.

## Historical radar and regional GIFs

The website’s **Historical GIF maker** sends:

- source: MRMS or KRAX
- Eastern Time start/end
- maximum frame count
- a named regional preset or current map bounds

The browser sends the owner key to the Cloudflare Worker, which verifies it before proxying the request. The Cloud Run admin service then validates the bounded parameters, starts the job with environment overrides, and writes status to R2. The same owner key controls Level II live polling and the expiring MRMS storm focus; it is kept only in browser session storage.

Local regional MRMS command:

```powershell
$env:MRMS_REGION_WEST = '-82.5'
$env:MRMS_REGION_SOUTH = '33.5'
$env:MRMS_REGION_EAST = '-75.0'
$env:MRMS_REGION_NORTH = '37.0'
python scripts/build_historical_radar.py `
  --start "2026-07-25T12:00:00-04:00" `
  --end "2026-07-25T14:00:00-04:00" `
  --max-frames 30 `
  --region-id mid-atlantic
```

Local KRAX command:

```powershell
python scripts/build_historical_krax.py `
  --start "2026-07-25T12:00:00-04:00" `
  --end "2026-07-25T14:00:00-04:00" `
  --max-frames 30
```

Generated history is catalog-driven; frame names are never hardcoded in the frontend.

## GIF exports

The browser’s **Save GIF** action uses:

- the current map pan and zoom
- the selected observed loop and FPS
- geography, city labels, and warning overlays
- a wall.cloud header and footer
- valid time and loop period
- a compact product-specific legend

The client uses the preview rasters from each PMTiles frame for deterministic export composition. GIF timing uses centiseconds, so very high FPS values use the nearest representable delay. GIF is palette-limited by design; lossless PMTiles/WebP remain the higher-fidelity interactive source. On phone-sized viewports, browser-generated GIFs use the latest 12 frames to remain within iOS memory limits; the full interactive loop remains available.

## Data contract

The public live manifest is `radar/manifest.json`:

```json
{
  "coverage": "conus",
  "delivery": "pmtiles",
  "latest_valid_time": "2026-07-27T18:28:41Z",
  "products": {
    "MergedReflectivityQCComposite": {
      "status": "ready",
      "frames": [
        {
          "valid_time": "2026-07-27T18:28:41Z",
          "url": "./national/previews/reflectivity-20260727T182841Z.webp",
          "pmtiles_url": "./national/frames/reflectivity-20260727T182841Z.pmtiles",
          "bounds": [-130, 20, -60, 55],
          "minzoom": 3,
          "maxzoom": 8
        }
      ]
    }
  }
}
```

Manifest replacement is atomic and manifests are uploaded after their referenced assets. Retained R2 frame references are reused so an unchanged observation is not downloaded and tiled again. Expired live frames and previews are pruned separately from historical datasets.

## Near-zero operating profile

The default production profile keeps recurring cloud charges near zero without removing the live national loop:

- The public repository runs `.github/workflows/national-radar-refresh.yml` every five minutes on a standard GitHub-hosted runner.
- GitHub Pages, the Cloudflare Worker, and current R2 live-data volume remain within their respective free allowances under normal traffic.
- Live frame objects are retained for one day while the public manifest exposes at most 30 observations selected from the recent 90-minute window, leaving most of R2's free storage allowance available for requested history.
- Cloud Run stays scale-to-zero and is used only when the owner requests a historical pack, explicitly enables KRAX live polling, or activates one storm-focus region.
- Storm focus replaces the previous selected region instead of creating another Scheduler, is limited to a 25° × 20° processing box, and expires after 12 hours unless the owner extends it.
- A new or long-stale national/focus dataset publishes the newest three frames first, restoring a usable loop in one bounded run before growing the rolling sequence incrementally.
- The expensive `wallcloud-mrms-refresh` Cloud Scheduler job is not enabled.
- Historical jobs, KRAX live control, and storm-focus control require the same owner key, preventing anonymous visitors from starting billable compute.

This targets a recurring baseline of approximately $0. Occasional owner-requested Cloud Run history work and unusually high R2/Worker traffic remain variable. GitHub scheduled workflows are best-effort: they can be delayed or dropped under load, and GitHub automatically disables schedules in a public repository after 60 days without repository activity. A later run reuses the R2 manifest and catches up recent observations still inside the 90-minute window.

## Cloud Run and R2 deployment

Detailed copy/paste commands are in [cloudrun/README.md](cloudrun/README.md). The near-zero production policy is:

- `wallcloud-mrms-refresh`: not deployed, or paused if it already exists
- `wallcloud-focus-refresh`: deployed once but paused unless an owner-selected storm focus is active
- `wallcloud-live-refresh`: paused by default, administrator-controlled
- `wallcloud-radar-history`: scale-to-zero and started only with the owner key

After changing processor code:

1. Build and push `Dockerfile.cloudrun` with `cloudbuild.yaml` when history, storm focus, KRAX, or the admin service changed.
2. Redeploy the shared history job, storm-focus job, optional KRAX job, and admin service as needed.
3. Apply R2 CORS, connect the R2 custom domain, and redeploy the Cloudflare Worker if its API contract changed.
4. Set the repository variables and bucket-scoped R2 Actions secrets below.
5. Push application code to `main`; Pages deploys the frontend and the national workflow begins using the new processor.
6. Manually dispatch `Refresh national MRMS radar` once and verify the R2 manifest before relying on its schedule.

Apply the checked-in R2 CORS policy and connect the production data hostname with current Wrangler:

```powershell
Push-Location control_worker
npx wrangler r2 bucket cors set wallcloud-radar-data --file ../deploy/vps/r2-cors.json --force
npx wrangler r2 bucket cors list wallcloud-radar-data
npx wrangler r2 bucket domain add wallcloud-radar-data --domain data.radar.wall.cloud --zone-id ZONE_ID --min-tls 1.2 --force
Pop-Location
```

The custom-domain command is one-time; use `npx wrangler r2 bucket domain list wallcloud-radar-data` to verify an existing connection rather than adding it again.

## GitHub Pages and Actions

Set repository variables:

- `RADAR_DATA_BASE_URL=https://data.radar.wall.cloud`
- `RADAR_CONTROL_API_URL=https://wallcloud-radar-control.jlwall33.workers.dev`
- `R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com`
- `R2_BUCKET=wallcloud-radar-data`

Set repository Actions secrets using an R2 Object Read & Write token scoped only to the radar bucket:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

`.github/workflows/pages.yml` builds and deploys the static frontend on every push to `main`.

`.github/workflows/national-radar-refresh.yml` uses the minimal `requirements-mrms-live.txt` dependency set, refreshes up to 30 national PMTiles observations from the recent 90-minute window every five minutes, publishes assets before the atomic manifest, and prunes expired live objects. Standard GitHub-hosted runners are free only while this repository remains public.

`.github/workflows/radar-refresh.yml` is a compatibility/manual deployment entry point. It now builds only the frontend. It does not generate radar data, so it cannot overwrite R2 or reintroduce an old NC manifest.

`.github/workflows/ci.yml` runs:

- frontend TypeScript checks
- Cloudflare Worker TypeScript checks
- production Vite build
- Python tests and Cloud Run script compilation

The older manual historical Actions workflows remain downloadable-artifact fallback tools. They upload generated packs to the workflow run for seven days and intentionally do not deploy or modify live R2 data. Production historical requests use Cloud Run and R2.

Custom domain:

```text
public/CNAME -> radar.wall.cloud
```

The DNS record should point to the configured GitHub Pages host. The R2 custom domain should allow range requests and CORS from `https://radar.wall.cloud`; PMTiles depends on HTTP byte-range responses.

## Validation

```powershell
npm run typecheck
npm run build
Push-Location control_worker
npm run typecheck
Pop-Location
python -m pytest -q
```

For an end-to-end national processor check:

```powershell
python scripts/build_national_mrms.py `
  --max-frames 1 `
  --retention-minutes 10 `
  --min-zoom 3 `
  --max-zoom 8 `
  --output-dir .radar-tmp\national-validation
```

## Project layout

- `src/radar/` — MapLibre viewer, animation, layers, warnings, GIF export, and responsive UI.
- `radar_processing/mrms.py` — official MRMS discovery, archive listing, retries, and downloads.
- `radar_processing/rendering.py` — MRMS decode, crop, and Wall Cloud palettes.
- `radar_processing/national_tiles.py` — shared georeferenced national/focus GeoTIFF, PMTiles, preview, manifest, and retention.
- `radar_processing/nexrad_*` — KRAX Level II listing, Py-ART decode, projection, and products.
- `radar_processing/r2.py` — R2 upload ordering, content types, cache headers, and pruning.
- `scripts/run_cloud_run_mrms_live.py` — national MRMS publisher used by GitHub Actions and the optional Cloud Run fallback.
- `scripts/run_cloud_run_mrms_focus.py` — expiring owner-selected regional MRMS publisher.
- `scripts/run_cloud_run_historical.py` — shared MRMS/KRAX history job.
- `scripts/run_cloud_run_live.py` — admin-controlled KRAX live job.
- `cloudrun/admin_service.py` — bounded job launch plus storm-focus and Level II Scheduler control.
- `control_worker/` — public browser proxy and protected admin control.
- `tests/` — deterministic pipeline and manifest tests.

## Known limitations

- National tiled live mode currently publishes composite reflectivity only.
- Storm focus currently supports one named regional preset at a time and publishes composite reflectivity only.
- Regional historical output remains image-frame based; it is intentionally cropped before browser delivery.
- National county and highway detail is loaded only after selecting or zooming into a region to avoid expensive CONUS geometry requests.
- Surface and buoy coverage still follows the existing eastern U.S./North Carolina station configuration.
- NWS, Census, CARTO, NDBC, NOAA operational directories, and R2 can be temporarily unavailable or rate-limited.
- PMTiles playback quality depends on network range-request latency on the first loop; visible adjacent frames are warmed in advance.
- KRAX has normal single-radar limitations including beam height, terrain blockage, ground clutter, and range.
- Cloud Run history limits are 24 hours for MRMS, 6 hours for KRAX, and 90 frames per request.

## Future migration

The manifest separates the frontend from the processor. A future worker, VPS, additional Cloud Run region, or another S3-compatible store can replace the current ingestion runtime without rewriting map playback. Planned extensions include nationally tiled PrecipFlag/QPE/storm-analysis products, dynamic nationwide surface observations, more Level II sites, and durable job queues with per-user rate limits.
