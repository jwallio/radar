# Wall Cloud Radar

Wall Cloud Radar is a static-build-compatible North Carolina radar viewer for `radar.wall.cloud`. It centers the map on North Carolina while keeping southern Virginia, eastern Tennessee, northern South Carolina, and nearby Atlantic waters in view.

The MVP provides:

- NOAA/NCEP MRMS regional composite-reflectivity imagery processed to PNG.
- A generated manifest and recent-frame playback with previous, play/pause, next, scrubber, and 0.5×/1×/2× controls.
- Downloadable, branded animated GIF loops generated with the same Wall Cloud palette.
- Selectable historical loop packs sourced from NOAA's public MRMS archive.
- A second precipitation-type mode backed by the official MRMS PrecipFlag product when it decodes successfully.
- Independent active NWS warning refreshes for tornado, severe thunderstorm, flash flood, and special marine warnings.
- Census TIGERweb state/county overlays, priority city labels, and an on-demand highway overlay.
- Responsive dark operational controls over a high-contrast light radar canvas for desktop, tablet, and mobile use.

## Architecture

```text
NOAA/NCEP MRMS GRIB2
        ↓
Python processor (download → cfgrib/eccodes decode → regional crop → PNG)
        ↓
public/data/radar/frames/*.png + loops/*.gif + history/* + manifests
        ↓
Vite/React/TypeScript + MapLibre image source
        ↓
GitHub Pages or another static host
```

The browser never downloads or decodes a full MRMS GRIB2 file. The frontend is independent of the ingestion runtime: the same generated `public/data/radar` artifact can later be copied to object storage or served by a small worker without changing the map client.

## Official data sources

Radar URLs are centralized in `radar_processing/config.py` and are based on the official MRMS directory listings:

- [MRMS 2D product directory](https://mrms.ncep.noaa.gov/2D/)
- [MergedReflectivityQCComposite](https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/)
- [PrecipFlag](https://mrms.ncep.noaa.gov/2D/PrecipFlag/)
- [NOAA MRMS archive on NODD/AWS](https://registry.opendata.aws/noaa-mrms-pds/)
- [MRMS operational flag table](https://www.nssl.noaa.gov/projects/mrms/operational/tables.php)
- [NWS API documentation](https://www.weather.gov/documentation/services-web-api)
- [NWS active alerts endpoint](https://api.weather.gov/alerts/active)
- [Census TIGERweb State/County service](https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer)
- [Census TIGERweb Transportation service](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer)

The map uses light raster tiles from [CARTO](https://carto.com/basemaps/) with OpenStreetMap attribution. NOAA/NWS and Census attribution is shown in the interface and documented here.

## Local setup — Windows PowerShell

Frontend dependencies:

```powershell
npm install
npm run dev
```

The committed manifest intentionally starts in a data-unavailable state. Generate live radar frames before expecting imagery locally:

```powershell
python -m pip install -r requirements-dev.txt
python scripts/build_radar_frames.py
npm run dev
```

The dev server is available at `http://localhost:5173` by default. The processor uses a temporary directory for raw downloads and removes raw GRIB2 files after rendering. It writes only generated PNGs and the manifest to `public/data/radar`.

Useful frontend checks:

```powershell
npm run typecheck
npm run build
npm run lint
```

`npm run lint` currently includes legacy dashboard files that predate the radar surface; the focused radar files are lint-clean. See the validation notes below.

## Python radar processing

The processor is intentionally split into focused modules:

- `radar_processing/config.py` — region, product, retention, and environment configuration.
- `radar_processing/mrms.py` — official directory listing parsing, timestamp matching, retries, and atomic downloads.
- `radar_processing/rendering.py` — cfgrib/eccodes crop, two-dBZ Wall Cloud palettes, PNG rendering, and PrecipFlag classification.
- `radar_processing/animation.py` — branded GIF composition with Census boundaries, city labels, valid times, and legends.
- `radar_processing/pipeline.py` — shared live/historical rendering and output rotation.
- `radar_processing/history.py` — historical dataset IDs and catalog maintenance.
- `radar_processing/manifest.py` — deterministic frame ordering, retention, missing-file filtering, stale detection, and atomic JSON replacement.
- `scripts/build_radar_frames.py` — orchestration and CLI.

Default region is `[-86.5, 32.5, -73.5, 39.5]` as west/south/east/north. Defaults retain 90 minutes of source history and render up to 30 frames, which is approximately 60 minutes at the current two-minute MRMS cadence. Set `MRMS_MAX_FRAMES=45` to target approximately 90 minutes.

Configuration can be supplied through environment variables:

```powershell
$env:MRMS_MAX_FRAMES = '30'
$env:MRMS_RETENTION_MINUTES = '90'
$env:MRMS_INCLUDE_PRECIP_TYPE = 'true'
$env:MRMS_REGION_WEST = '-86.5'
$env:MRMS_REGION_EAST = '-73.5'
python scripts/build_radar_frames.py
```

Use `python scripts/build_radar_frames.py --no-precip-type` for a reflectivity-only run or `--keep-raw` only when troubleshooting decoder inputs. Raw files and local caches are ignored by Git.

Each successful run also writes `public/data/radar/loops/composite-reflectivity.gif` and, when available, `precipitation-type.gif`. The viewer exposes the active product's GIF through **Save GIF**.

## Historical radar loops

Historical products come from NOAA's public `noaa-mrms-pds` NODD archive, whose daily `MergedReflectivityQCComposite_00.50` and `PrecipFlag_00.00` folders extend back to October 2020. Timestamps must include a timezone so an Eastern local time is never mistaken for UTC.

Build a 90-minute historical pack locally:

```powershell
python scripts/build_historical_radar.py `
  --start '2025-06-19T14:00:00-04:00' `
  --end '2025-06-19T15:30:00-04:00' `
  --label 'June 19, 2025 severe weather' `
  --max-frames 45
npm run dev
```

The script downloads only the selected archive frames, crops the NC region, creates PNG and GIF loops, writes a dataset manifest under `public/data/radar/history/<dataset-id>/`, and atomically updates `history/catalog.json`. The viewer's **Loop source** selector discovers it automatically. Use `--no-precip-type` when only composite reflectivity is needed.

## Manifest contract

`public/data/radar/manifest.json` is replaced atomically. It has a `products` map so additional MRMS products can be added without changing the frontend contract:

```json
{
  "mode": "live",
  "dataset_id": "live",
  "product": "MergedReflectivityQCComposite",
  "latest_valid_time": "2026-07-21T22:00:00Z",
  "products": {
    "MergedReflectivityQCComposite": { "status": "ready", "frames": [], "loop_url": "./loops/composite-reflectivity.gif" },
    "PrecipFlag": { "status": "ready", "frames": [] }
  }
}
```

The frontend uses relative frame URLs, so the same artifact works at a custom-domain root or a GitHub Pages project path. Missing manifests, missing frame files, stale timestamps, and partial PrecipFlag output are surfaced as meaningful UI states.

## Testing

Run the focused Python tests with:

```powershell
python -m pytest -q tests/test_radar_processing.py
```

The tests cover chronological ordering, retention, missing frame handling, stale timestamps, regional bounds, two-dBZ palette spacing, archive-list parsing, historical catalog updates, GIF animation output, and NOAA PrecipFlag category mapping. Live and historical processor smoke tests produced decoded PNGs, GIFs, and atomic manifests from official NOAA sources.

## GitHub Actions and Pages

`.github/workflows/radar-refresh.yml` targets a five-minute schedule, but GitHub Actions schedules are best-effort and should not be treated as guaranteed two-minute ingestion. Each run:

1. Installs Python GRIB2 dependencies.
2. Downloads and renders regional MRMS frames.
3. Builds the Vite site with those generated files.
4. Uploads and deploys one Pages artifact.

It never commits radar images to the repository. `.github/workflows/pages.yml` provides a normal source-code-to-GitHub-Pages deployment for pushes and manual runs; the scheduled workflow is the one that includes fresh generated radar data.

The **Build and deploy a historical radar loop** workflow accepts timezone-aware start/end values, restores earlier generated packs from the GitHub Actions cache, adds the requested loop, refreshes live radar, and deploys the combined site. Scheduled live refreshes restore that latest historical bundle before deploying, so historical selections are not erased by the next live update. Actions cache retention is suitable for an MVP; durable object storage is still the recommended long-term archive.

`public/CNAME` records the intended `radar.wall.cloud` hostname. Because this project deploys through a custom GitHub Actions workflow, also enter `radar.wall.cloud` under **Settings → Pages → Custom domain**; GitHub does not configure an Actions-based custom domain from the file alone. At the DNS provider, point the `radar` CNAME to `<owner>.github.io` (without the repository name). For `radar.wall.cloud`, use `VITE_BASE_PATH=/`. For a GitHub Pages project site, set `VITE_BASE_PATH` to the project path, for example:

```powershell
$env:VITE_BASE_PATH = 'wallcloud-weather-dashboard'
npm run build
```

Enable GitHub Pages with **GitHub Actions** as the build source. The scheduled workflow requires the repository’s Pages environment and deployment permissions to be enabled.

## Known limitations

- MRMS source files are full CONUS GRIB2 downloads; this pass crops to the NC regional domain after decode because the official directory does not expose a browser-friendly regional subset.
- cfgrib/eccodes includes a native dependency. `requirements.txt` uses the portable Python packages/wheels available for Windows and GitHub Actions Linux; if a local Python distribution cannot load ecCodes, use a current Conda environment or the documented Linux CI setup.
- PrecipFlag provides published flag classes such as rain, snow, convection, hail, and cool stratiform rain. Unknown/non-published values fall back to reflectivity colors and are not labeled as a fabricated precipitation type.
- NWS alerts are fetched client-side, so an ad-blocker, CORS issue, rate limit, or upstream outage can degrade warning refresh while leaving the last successful result visible.
- The static MVP uses CARTO raster basemap tiles and Census TIGERweb overlays at runtime. A future production deployment should proxy or cache these sources if traffic requires stronger availability guarantees.
- GitHub Actions is not a real-time scheduler. A worker or persistent object-store pipeline is recommended for lower-latency updates.
- Historical packs available in the static viewer are generated selections, not arbitrary browser-side GRIB decoding. GitHub Actions caches preserve them for the MVP, but cache eviction can remove old packs; use R2/S3 for permanent public history.

## Future migration path

The frontend consumes only `manifest.json` and relative/absolute raster URLs. A future worker can run `scripts/build_radar_frames.py` on Cloud Run, a small VPS, or a scheduled container, then upload the generated `frames/` and manifest to Cloudflare R2, S3-compatible storage, or another CDN. Change the manifest base URL or static hosting configuration; the MapLibre client and animation controls do not need to decode or understand GRIB2.
