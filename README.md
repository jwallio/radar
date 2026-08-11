# wall.cloud Radar

wall.cloud Radar is an archive-first radar playback tool for [radar.wall.cloud](https://radar.wall.cloud). The public default frames the Atlantic and Caribbean storm corridor, preferring observed NOAA/NCEP radar products while keeping ERA5 historical reanalysis available for coverage and parameter gaps. ERA5 is a reconstruction, not observed radar.

The browser never downloads or decodes GRIB2 or Level II files.

## Features

- Historical MRMS, NEXRAD Level II, and ERA5 datasets delivered through source-specific manifests.
- MRMS archive coverage from 2014-11-24 onward, with the configured full MRMS product suite available for packs beginning 2020-10-14.
- Atlantic & Caribbean map framing for tropical systems and East Coast storms, with North Carolina, Southeast, and Northeast presets retained.
- Archive-frame animation, timeline scrubbing, previous/next, and 2/4/8/20/30 FPS playback.
- Adjacent PMTiles preloading to reduce frame-change flashing.
- Public bounded MRMS and ERA5 archive jobs, plus administrator-only KRAX jobs, using Eastern Time date controls.
- ERA5 hourly precipitation reconstructions from the official Copernicus CDS API, explicitly labelled as reanalysis-based, spatially interpolated for display, and not observed radar.
- Branded current-view GIF downloads.
- Static state boundaries, zoom-dependent counties, major cities, and on-demand highways.
- Radar and map-layer opacity control.
- Graceful missing, unavailable, processing, and source-gap states.
- Mobile controls with rotation and map pitch disabled.

## Architecture

```text
Official NOAA/NCEP and Copernicus archive sources
                  |
                  v
    Archive build jobs
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
   Cloudflare Worker (source-aware proxy)
                  |
                  v
    scale-to-zero Cloud Run admin service
        |              |              |
        v              v              v
 regional MRMS   NEXRAD Level II    ERA5 history
   archive job      archive job       CDS client
        |              |              |
        +--------------+--------------+
                       v
        frames / PMTiles + manifests in R2
```

Responsibilities are intentionally split:

- Archive jobs download and decode requested historical datasets; GitHub Pages publishes only static application code.
- Cloud Run handles bounded archive generation and scales to zero after the pack is complete.
- R2 stores generated browser assets and atomic manifests.
- The Worker hides the Cloud Run service token, accepts public bounded MRMS/ERA5 requests, and requires the administrator key for KRAX and live-control changes.
- MapLibre renders the basemap, boundaries, labels, archive overlays, and playback frames.

This keeps the public viewer decoupled from source ingestion and prevents a Pages deployment from replacing archive manifests or retained assets.

## Official data and attribution

Radar data is sourced only from official NOAA/NCEP or NOAA-hosted public datasets:

- [MRMS operational products](https://mrms.ncep.noaa.gov/2D/)
- [MergedReflectivityQCComposite](https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/)
- [PrecipFlag](https://mrms.ncep.noaa.gov/2D/PrecipFlag/)
- [NOAA MRMS archive on the Registry of Open Data on AWS](https://registry.opendata.aws/noaa-mrms-pds/)
- [NOAA NEXRAD Level II archive](https://registry.opendata.aws/noaa-nexrad/)
- [ERA5 hourly single levels from 1940 to present](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels) — Copernicus Climate Change Service / ECMWF
- [CDS API setup and current `cdsapi` client guidance](https://cds.climate.copernicus.eu/how-to-api)
- [ECMWF ERA5 precipitation type documentation](https://confluence.ecmwf.int/pages/viewpage.action?pageId=179741903)
- [ECMWF accumulated-variable conversion guidance](https://confluence.ecmwf.int/spaces/CKB/pages/197702790/Conversion%2Btable%2Bfor%2Baccumulated%2Bvariables%2Btotal%2Bprecipitation%2Bfluxes)
- [NWS API](https://www.weather.gov/documentation/services-web-api) — current warning integration
- [Iowa Environmental Mesonet warning archive](https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py?help=) — archived NWS watch/warning/advisory polygon metadata used for historical overlays
- [NOAA NDBC](https://www.ndbc.noaa.gov/) — retained legacy buoy integration

Historical warning polygons are retrieved from the Iowa Environmental Mesonet's archive of NWS VTEC warning data because the current NWS alert feed cannot reconstruct older events. This is an external university-processed archive, not an official government warning service. wall.cloud is not an official government warning service; users should consult official NWS products for safety decisions.

## Radar products

The explicit source hierarchy is: NEXRAD Level II for observed single-site radar, MRMS for radar-derived national/regional analysis, and ERA5 Historical Precipitation Reconstruction as a selectable gap-fill source when observed coverage or a requested parameter is unavailable. The viewer defaults to MRMS and never silently blends ERA5 into observed radar.

MRMS archive coverage begins at `2014-11-24T00:00:00Z`. Packs beginning on or after `2020-10-14T00:00:00Z` request the full configured MRMS suite; earlier packs are core archives and do not claim derived-product coverage. The expanded viewer can show the Caribbean and western Atlantic for storm context, but observed MRMS archive rasters remain bounded by the CONUS product grid (`20–55°N`, `130–60°W`).

The retained source-processing paths currently support:

- `MergedReflectivityQCComposite`

Core regional MRMS archives support:

- `PrecipFlag`

Full-suite regional MRMS archives beginning 2020-10-14 also support the existing product architecture for:

- one-hour multi-sensor QPE
- low- and mid-level azimuthal shear
- 30-minute rotation tracks
- MESH and POSH
- NLDN cloud-to-ground lightning density

The full-suite historical builder aligns derived MRMS frames to the primary reflectivity timeline. A product remains explicitly unavailable when its source listing or decode fails; the UI does not fabricate a layer from a missing field. ERA5 is the broader hourly reanalysis option for the Caribbean and western Atlantic portion of the map.

KRAX Level II supports:

- Base Reflectivity
- Radial Velocity
- Correlation Coefficient

Level II is single-site radar data, not a replacement for the quality-controlled national MRMS mosaic.

ERA5 historical products are a separate scientific source. They use the documented ECMWF `precipitation_type` code table and hourly `total_precipitation` in mm/hour on the native 0.25° regular latitude/longitude grid. The map uses linear spatial resampling to soften native grid-cell edges and labels the result as an interpolated display; this does not add detail or change the hourly values. The phase/intensity renderer does not infer dBZ and does not interpolate hourly fields into five-minute observations. Every ERA5 manifest includes `source_type: reanalysis`, `observed: false`, `temporal_resolution: hourly`, provenance, methodology, and reconstruction-version metadata.

The renderer uses the ECMWF precipitation-type codes centrally: `0` none, `1` rain, `3` freezing rain, `5` snow, `6` wet snow, `7` mixed rain/snow, and `8` ice pellets. Unknown codes are transparent/undefined rather than assigned a guessed phase. `total_precipitation` is an hourly accumulation in metres of water equivalent and is converted to mm/hour by multiplying by 1,000; its rate controls intensity within each phase family.

Only `precipitation_type` and `total_precipitation` are requested. ERA5 snowfall, snowmelt, temperature, dewpoint, skin temperature, total-column water, and surface pressure are intentionally not used because the primary ptype field already supplies the phase classification and adding unrelated fields would increase request size without improving this first reconstruction product.

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
- the official `cdsapi>=0.7.7` client for Copernicus CDS ERA5 requests

On Windows, a fresh isolated Python environment is strongly preferred over mixing binary NumPy/SciPy packages into an existing Conda base environment.

## Validate archive processors locally

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

## Archive packs and regional GIFs

The website’s **Archive pack builder** sends:

- source: MRMS, KRAX, or ERA5
- Eastern Time start/end
- maximum frame count
- a named regional preset or current map bounds

The browser sends MRMS and ERA5 requests to the Cloudflare Worker without a visitor credential. KRAX generation remains administrator-only and prompts for the owner key, which is kept only in browser session storage. The Worker keeps the Cloud Run service token private, and the Cloud Run admin service validates the bounded parameters again before starting the archive job and writing status to R2.

Because MRMS and ERA5 generation is public, an anonymous visitor can start bounded billable work. Frame, duration, and geographic limits still apply; ERA5 is also cache-first and limited to one active request. These safeguards reduce cost but are not a substitute for per-user rate limiting.

ERA5 requests are whole-hour UTC windows after Eastern Time conversion, limited to seven days/168 frames, bounded inside the ERA5 processing domain (`[-130, 10, -55, 55]`), and rejected if they include future hours. The Atlantic & Caribbean preset requests `[-100, 12, -55, 52]`. A single active ERA5 job is allowed. Complete deterministic datasets are reused from `radar/history/era5/{dataset_id}/manifest.json` before another CDS request is made.

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

Without explicit `MRMS_REGION_*` overrides, historical MRMS uses the CONUS-covered Atlantic corridor `[-100, 20, -60, 52]`; the map itself may still show the broader Caribbean and western Atlantic context.

The builder rejects starts before `2014-11-24T00:00:00Z`. A pack whose start is on or after `2020-10-14T00:00:00Z` also enumerates and aligns the configured derived MRMS products; earlier packs remain core reflectivity/precipitation-type archives.

Local KRAX command:

```powershell
python scripts/build_historical_krax.py `
  --start "2026-07-25T12:00:00-04:00" `
  --end "2026-07-25T14:00:00-04:00" `
  --max-frames 30
```

Generated history is catalog-driven; frame names are never hardcoded in the frontend.

Local ERA5 validation writes only to the requested output directory. This example requires a CDS personal access token in the process environment and never places it in the browser or a repository file:

```powershell
$env:CDSAPI_KEY = 'personal-token-from-your-CDS-profile'
python scripts/build_historical_era5.py `
  --start "2016-01-22T12:00:00-05:00" `
  --end "2016-01-23T12:00:00-05:00" `
  --region-id mid-atlantic `
  --west -84.5 --south 33.0 --east -72.5 --north 42.5 `
  --max-frames 168 `
  --output-dir .radar-tmp\era5-validation
```

The request produces hourly PNG frames, a phase/intensity loop, a total-precipitation loop, and a catalog under `.radar-tmp\era5-validation`. The production Cloud Run job uses Secret Manager for `CDSAPI_KEY`; do not use `VITE_*`, commit a CDS token, or request ERA5 directly from the browser.

For a real validation case, use a period with a known Southeast or Mid-Atlantic winter storm, inspect the generated phase and intensity frames for geographic orientation, UTC/ET timestamps, broad precipitation placement, and plausible rain/snow transitions, then compare qualitatively with available MRMS/NEXRAD imagery. The comparison is a sanity check only; the ERA5 rendering is not tuned to imitate radar and remains labelled as a reconstruction.

## GIF exports

The browser’s **Save GIF** action uses:

- the current map pan and zoom
- the selected archive loop and FPS
- geography, city labels, and map overlays
- a wall.cloud header and footer
- valid time and loop period
- a compact product-specific legend

The client uses the preview rasters from each PMTiles frame for deterministic export composition. GIF timing uses centiseconds, so very high FPS values use the nearest representable delay. GIF is palette-limited by design; lossless PMTiles/WebP remain the higher-fidelity interactive source. On phone-sized viewports, browser-generated GIFs use the latest 12 frames to remain within iOS memory limits; the full interactive loop remains available.

ERA5 exports use a reanalysis footer rather than the observed-radar footer and retain the hourly source label in the header.

## Data contract

The archive viewer first loads a source-specific catalog. Published catalogs are:

- MRMS: `radar/history/catalog.json`
- NEXRAD Level II: `radar/krax/history/catalog.json`
- ERA5: `radar/history/era5/catalog.json`

Each catalog entry points to an immutable pack manifest. A selected pack uses this frame contract:

```json
{
  "source": "mrms",
  "source_type": "observed",
  "observed": true,
  "mrms_product_tier": "full",
  "coverage": "regional",
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

Manifest replacement is atomic and manifests are uploaded after their referenced assets. Retained R2 frame references are reused so an unchanged source frame is not downloaded and tiled again. Historical packs are retained by dataset ID; expired live-frame pruning applies only to legacy ingestion paths.

Historical R2 namespaces are source-specific: MRMS uses `radar/history/catalog.json`, KRAX uses `radar/krax/history/catalog.json`, and ERA5 uses `radar/history/era5/catalog.json` with complete packs below `radar/history/era5/{dataset_id}/`. MRMS manifests declare `mrms_product_tier: core|full` and the two archive boundary timestamps. ERA5 packs are versioned by source, exact UTC hour window, bounded region, and reconstruction version so a renderer change cannot silently reuse an incompatible cache.

## Archive operating profile

The default production profile keeps recurring cloud charges near zero while the public site remains an archive browser:

- GitHub Pages serves the static archive viewer; the browser does not poll live radar or control status. Current NWS warning polygons are fetched only after a visitor explicitly enables that overlay.
- The Cloudflare Worker and R2 serve published catalogs and immutable historical packs without a recurring national refresh loop.
- Cloud Run stays scale-to-zero and is used when a visitor requests a bounded MRMS/ERA5 pack or the owner requests a KRAX pack.
- ERA5 requests are public, one-at-a-time, bounded, and cache-first; repeated requests for the same source/time/region/version reuse the complete R2 dataset.
- Legacy live publishers and their control endpoints remain paused and are not selected by the public archive UI.
- KRAX history and all legacy live-control mutations still require the owner key.

This targets a recurring idle baseline of approximately $0. Public MRMS/ERA5 generation and unusually high R2/Worker traffic remain variable and can create charges when visitors request uncached packs.

## Cloud Run and R2 deployment

Detailed copy/paste commands are in [cloudrun/README.md](cloudrun/README.md). The near-zero production policy is:

- `wallcloud-mrms-refresh`: legacy, paused
- `wallcloud-focus-refresh`: legacy, paused
- `wallcloud-live-refresh`: legacy, paused
- `wallcloud-radar-history`: scale-to-zero; public MRMS/ERA5 requests and administrator-only KRAX requests start it through the Worker
- `CDSAPI_KEY`: Secret Manager-only server credential for ERA5 history; it is never sent to the browser

After changing processor code:

1. Build and push `Dockerfile.cloudrun` with `cloudbuild.yaml` when history, ERA5, regional archive, or the admin service changed.
2. Redeploy the shared history job and admin service as needed.
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

`.github/workflows/national-radar-refresh.yml` is a legacy live-data compatibility path and is paused for the archive-first product. It is not used to populate the public archive catalogs.

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
- `radar_processing/era5.py` — bounded CDS requests, GRIB decoding, hourly validation, deterministic cache IDs, and provenance manifests.
- `radar_processing/era5_rendering.py` — native-grid crop and precipitation phase/intensity palettes.
- `radar_processing/r2.py` — R2 upload ordering, content types, cache headers, and pruning.
- `scripts/run_cloud_run_mrms_live.py` — legacy national MRMS publisher retained for migration compatibility.
- `scripts/run_cloud_run_mrms_focus.py` — legacy expiring regional MRMS publisher retained for migration compatibility.
- `scripts/build_historical_era5.py` — local/Cloud Run ERA5 hourly reconstruction builder.
- `scripts/run_cloud_run_historical.py` — shared MRMS/KRAX/ERA5 history job with R2 cache reuse and progress stages.
- `scripts/run_cloud_run_live.py` — legacy admin-controlled KRAX live job.
- `cloudrun/admin_service.py` — bounded archive job launch; legacy live controls remain for migration compatibility.
- `control_worker/` — public browser proxy and protected archive control.
- `tests/` — deterministic pipeline and manifest tests.

## Known limitations

- The public viewer is archive-only; legacy live and storm-focus processors are not exposed in the current UI.
- Regional historical output remains image-frame based; it is intentionally cropped before browser delivery.
- National county and highway detail is loaded only after selecting or zooming into a region to avoid expensive CONUS geometry requests.
- Warning polygons can be enabled on demand for situational awareness. Historical MRMS/KRAX frames use time-matched polygons from the IEM NWS warning archive, while live mode uses current NWS alerts; ERA5 does not provide warning overlays. Surface observations and buoy integrations remain outside public archive playback.
- Census, CARTO, NOAA archive directories, CDS, and R2 can be temporarily unavailable or rate-limited.
- PMTiles playback quality depends on network range-request latency on the first loop; visible adjacent frames are warmed in advance.
- KRAX has normal single-radar limitations including beam height, terrain blockage, ground clutter, and range.
- Cloud Run history limits are 24 hours for MRMS, 6 hours for KRAX, and 90 frames per request; MRMS requests before 2014-11-24 are rejected, and full-suite MRMS requests begin at 2020-10-14. ERA5 is limited to seven days/168 hourly frames, the CONUS domain, and one active job.
- ERA5 is available from 1940 onward with approximately five-day publication latency; it is a reanalysis reconstruction and must not be presented as observed radar.

## Future migration

The manifest separates the frontend from the processor. A future worker, VPS, additional Cloud Run region, or another S3-compatible store can replace the current archive runtime without rewriting map playback. Planned extensions include additional North Carolina archive packs, Southeast and Northeast presets, more Level II sites, nationwide PMTiles coverage, and durable job queues with per-user rate limits.
