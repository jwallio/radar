# wall.cloud Radar

wall.cloud Radar is a static-build-compatible North Carolina radar viewer for [radar.wall.cloud](https://radar.wall.cloud). It is designed as an operational meteorology tool: the radar remains dominant, controls stay compact, and the browser consumes prepared raster frames instead of decoding raw weather files.

The default map covers North Carolina, southern Virginia, eastern Tennessee, northern South Carolina, and nearby Atlantic waters.

## What it includes

- MRMS regional composite reflectivity with recent-frame animation.
- KRAX-only NOAA NEXRAD Level II base reflectivity with recent completed-volume playback.
- Historical MRMS and KRAX loops generated from official public archives.
- Exact observed-frame playback with Previous, Play/Pause, Next, timeline scrubbing, and 2/4/8/20/30 FPS controls.
- Product modes for Composite Reflectivity, MRMS PrecipFlag, and one-hour MRMS rainfall.
- Latest-analysis overlays for azimuthal shear, rotation tracks, MESH, POSH, and NLDN cloud-to-ground lightning density when generated.
- Active NWS warning polygons for tornado, severe thunderstorm, flash flood, and special marine warnings.
- High-contrast warning halos and borders that remain visible over heavy radar echoes.
- NWS surface observations and NOAA NDBC buoy observations.
- State, county, city, and optional highway overlays.
- A pre-rendered branded loop and a client-side **Save GIF** export.

The viewer shows radar valid times in Eastern Time. Missing, stale, partial, or unavailable data is displayed as an explicit status rather than a blank map.

## Architecture

```text
Official NOAA/NCEP source
        |
        +--> MRMS GRIB2 --> Python/cfgrib/eccodes --> regional PNG frames
        |
        +--> KRAX Level II --> Python/Py-ART --> projected PNG frames
                                      |
                                      v
                         manifests, loops, and history catalogs
                                      |
                                      v
                       Vite + React + TypeScript + MapLibre
                                      |
                                      v
                              GitHub Pages / static host
```

The browser never downloads or decodes full MRMS GRIB2 or NEXRAD Level II files. Python handles discovery, download, decoding, regional rendering, retention, atomic manifest replacement, and GIF generation. The frontend consumes `manifest.json`, relative frame URLs, and optional history catalogs.

The ingestion layer is intentionally separate from the frontend. It can later move to Cloud Run, a small VPS, a scheduled worker, or object storage without changing the MapLibre client.

## Official sources and attribution

Radar data comes from official public NOAA/NCEP/Unidata sources:

- [MRMS operational directory](https://mrms.ncep.noaa.gov/2D/)
- [MergedReflectivityQCComposite](https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/)
- [PrecipFlag](https://mrms.ncep.noaa.gov/2D/PrecipFlag/)
- [MRMS NODD archive](https://registry.opendata.aws/noaa-mrms-pds/)
- [NOAA NEXRAD Level II on AWS](https://registry.opendata.aws/noaa-nexrad/)
- [NEXRAD archive bucket](https://unidata-nexrad-level2.s3.amazonaws.com/)
- [NEXRAD real-time chunks bucket](https://unidata-nexrad-level2-chunks.s3.amazonaws.com/)
- [NOAA NCEI NEXRAD documentation](https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar)
- [ARM Py-ART](https://arm-doe.github.io/pyart/) for Archive II decoding
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- [NWS active alerts](https://api.weather.gov/alerts/active)
- [NOAA NDBC station data](https://www.ndbc.noaa.gov/)
- [U.S. Census TIGERweb](https://tigerweb.geo.census.gov/)

The map uses label-free CARTO raster tiles with OpenStreetMap attribution. City and highway labels are supplied by wall.cloud/Census overlays so important labels appear once and remain readable above radar.

## Local development — Windows PowerShell

From the project directory:

```powershell
cd D:\weather-projects\wallcloud-weather-dashboard
npm install
npm run dev
```

The frontend normally opens at `http://localhost:5173`.

Install all development and radar-processing dependencies:

```powershell
python -m pip install -r requirements-dev.txt
```

`requirements-dev.txt` includes the base MRMS requirements and the isolated NEXRAD/Py-ART requirements. If only the KRAX processor is needed:

```powershell
python -m pip install -r requirements-nexrad.txt
```

The committed seed manifests intentionally start unavailable. Generate data locally before expecting radar imagery.

## Generate recent radar

MRMS:

```powershell
python scripts/build_radar_frames.py
npm run dev
```

KRAX Level II:

```powershell
python scripts/build_krax_radar.py
npm run dev
```

Fast KRAX smoke test:

```powershell
python scripts/build_krax_radar.py --max-frames 1 --retention-minutes 30
```

The KRAX processor discovers completed `KRAX` volume files from the public archive, downloads them to temporary storage, decodes the lowest available sweep with Py-ART, projects the gates to the configured NC region, writes PNG frames, and removes temporary raw files unless explicitly retained.

Useful MRMS environment settings:

```powershell
$env:MRMS_MAX_FRAMES = '45'
$env:MRMS_RETENTION_MINUTES = '90'
$env:MRMS_INCLUDE_PRECIP_TYPE = 'true'
python scripts/build_radar_frames.py
```

Useful KRAX environment settings:

```powershell
$env:NEXRAD_MAX_FRAMES = '18'
$env:NEXRAD_RETENTION_MINUTES = '90'
$env:NEXRAD_IMAGE_WIDTH = '1200'
python scripts/build_krax_radar.py
```

Raw downloads and generated frames/loops are ignored by Git. Do not commit GRIB2, Level II, PNG, or GIF output.

## Historical radar

Historical MRMS loop:

```powershell
python scripts/build_historical_radar.py `
  --start '2025-06-19T14:00:00-04:00' `
  --end '2025-06-19T15:30:00-04:00' `
  --label 'June 19, 2025 severe weather' `
  --max-frames 45
```

Historical KRAX loop:

```powershell
python scripts/build_historical_krax.py `
  --start '2025-06-19T14:00:00-04:00' `
  --end '2025-06-19T15:30:00-04:00' `
  --label 'KRAX June 19, 2025' `
  --max-frames 30
```

Historical times must include a timezone. The scripts convert the range to UTC while the viewer displays valid times in Eastern Time.

The GitHub Actions historical workflows provide dropdowns for common Eastern
Time ranges: today, yesterday, recent days, the current time, recent offsets,
and loop duration. Choose `custom` only for an older date or a specific ET
clock time. The workflow runs `scripts/resolve_history_window.py`, which turns
those selections into timezone-aware ISO timestamps before invoking the MRMS
or KRAX builder. No manual ISO timestamp entry is needed for routine builds.

Generated MRMS packs are written under `public/data/radar/history/<dataset-id>/`. KRAX packs are written under `public/data/radar/krax/history/<dataset-id>/`. Each source has an independent atomic catalog, and the viewer discovers generated packs through the **Loop source** selector.

Historical packs are limited to 24 hours and 90 sampled frames per request to keep download, decode, GIF, and static-hosting costs bounded.

## GIF exports

The **Branded loop** is a server-generated reference-style loop with:

- `wall.cloud` header and dark-navy `wall.cloud` branding.
- Large, bold Eastern valid time and product/source metadata.
- State/county/city geography and clean borders.
- A compact, semi-transparent lower-right reflectivity, precipitation, or rainfall legend that preserves map width and minimizes obscured data.
- Primary and secondary city-label tiers for a cleaner geographic hierarchy.
- Footer branding, observed-loop period, frame count, and playback FPS.
- Central NC framing with coastal North Carolina and nearby Atlantic waters.

The **Save GIF** button is client-side. It uses the current map zoom/pan, selected playback FPS, local radar raster, geography overlays, warnings, optional highways, city labels, valid times, and the same branded header, compact legend overlay, and footer treatment as the pre-rendered loop. Recent exports use the neutral **Observed loop** label; historical exports add **Archive**. GIF timing is quantized to centiseconds by the GIF format, so 20 and 30 FPS use the nearest representable delay.

## Generated artifact contract

MRMS live data is published at:

```text
public/data/radar/manifest.json
public/data/radar/frames/
public/data/radar/loops/
public/data/radar/history/catalog.json
```

KRAX live data uses:

```text
public/data/radar/krax/manifest.json
public/data/radar/krax/frames/
public/data/radar/krax/loops/
public/data/radar/krax/history/catalog.json
```

Manifests include product status, valid times, relative frame URLs, bounds, source metadata, loop metadata, and error messages. They are written atomically so the frontend does not read a partially generated file.

## Project layout

- `src/radar/` — MapLibre viewer, controls, layers, legends, playback, and GIF export.
- `radar_processing/mrms.py` — MRMS discovery and download.
- `radar_processing/rendering.py` — MRMS decode, crop, palettes, and raster output.
- `radar_processing/pipeline.py` — MRMS live/history orchestration.
- `radar_processing/nexrad.py` — KRAX archive listing, filtering, sampling, retries, and downloads.
- `radar_processing/nexrad_rendering.py` — Py-ART Level II decode and geographic projection.
- `radar_processing/nexrad_pipeline.py` — KRAX rendering, rotation, manifests, and branded loops.
- `radar_processing/animation.py` — shared branded GIF composition.
- `scripts/build_radar_frames.py` — recent MRMS CLI.
- `scripts/build_historical_radar.py` — historical MRMS CLI.
- `scripts/build_krax_radar.py` — recent KRAX CLI.
- `scripts/build_historical_krax.py` — historical KRAX CLI.
- `tests/` — Python pipeline tests.
- `.github/workflows/` — CI, Pages, scheduled refresh, and historical build workflows.

## Validation

Run the focused checks:

```powershell
python -m pytest -q
npm run typecheck
npm run build
```

The NEXRAD test suite covers filename parsing, official-listing parsing, KRAX-only configuration, retention and sampling, geographic gate projection, chronological manifests, and atomic output generation.

The focused radar frontend files are lint-clean. The repository-wide `npm run lint` command also scans older dashboard hooks outside the radar surface and may report legacy errors unrelated to this viewer.

## GitHub Actions and Pages

### Normal Pages deployment

`.github/workflows/pages.yml` runs the shared radar refresh/deployment workflow from `main`. This prevents a source-only deployment from replacing generated live radar with the unavailable seed manifests. A push to `main` is the normal source-code deployment path.

Enable Pages in the repository settings with **GitHub Actions** as the build source. The workflow requires Pages write and deployment permissions.

### Scheduled radar refresh

`.github/workflows/radar-refresh.yml` targets approximately every five minutes. GitHub Actions schedules are best-effort and are not guaranteed real-time ingestion.

Each refresh:

1. Restores cached historical packs.
2. Installs MRMS and Py-ART/NEXRAD dependencies.
3. Builds fresh MRMS radar.
4. Attempts the KRAX build without discarding a working MRMS deployment if KRAX fails.
5. Builds the Vite site with generated artifacts.
6. Deploys a Pages artifact.

The workflow does not commit generated radar output to Git.

Radar manifests and history catalogs are requested with a cache-busting query so
five-minute browser polling cannot be held behind the GitHub Pages CDN cache.
Every production build also exposes its commit through the root
`data-build-sha` attribute for deployment verification.

### Historical workflows

- `historical-radar.yml` builds a requested MRMS archive loop and saves it to the
  Actions cache.
- `historical-krax.yml` builds a requested KRAX Level II archive loop and saves it
  to the Actions cache.

Historical workflows do not deploy GitHub Pages directly. A historical run may
start from an older commit and finish after newer frontend code has been
published; deploying from that old checkout could roll the site backward. After
saving the archive, the workflow dispatches `radar-refresh.yml` on the current
`main` branch. The refresh workflow restores the archive and deploys the latest
frontend source. The regular refresh also verifies that its commit is still the
current `main` commit immediately before deploying.

Both workflows accept timezone-aware start/end values and preserve prior history through GitHub Actions caches. Caches are suitable for the MVP but are not permanent archival storage.

### Custom domain

`public/CNAME` contains `radar.wall.cloud`. In GitHub repository settings, configure Pages with the custom domain `radar.wall.cloud`. At the DNS provider, point the `radar` CNAME to the repository owner’s `*.github.io` hostname. For the custom-domain root, use:

```powershell
$env:VITE_BASE_PATH = '/'
npm run build
```

## Known limitations

- MRMS source files are full CONUS GRIB2 downloads and are cropped after decode.
- KRAX is a single radar, not a quality-controlled mosaic. Beam height, terrain blockage, ground clutter, and biological returns vary with range.
- Current KRAX live mode uses the newest completed archive volumes. Direct assembly of the real-time chunk bucket is reserved for a future persistent worker.
- Py-ART/ecCodes has a larger native dependency footprint than the MRMS renderer. GitHub Actions Linux is the reference deployment environment if a Windows Python distribution lacks compatible wheels.
- MRMS storm-analysis layers are latest-analysis overlays, not historical animated products.
- Historical packs are generated selections; anonymous visitors cannot request arbitrary archive dates from static GitHub Pages.
- GitHub Actions is not a guaranteed real-time scheduler. A persistent worker and object storage are recommended for lower latency and permanent history.
- External CARTO, Census, NWS, and NDBC services can be rate-limited or temporarily unavailable. The viewer reports degraded states where possible.

## Future migration path

The frontend only needs manifests and raster URLs. A future scheduled worker can run the existing Python processors on Cloud Run, a small VPS, or a container worker, then upload frames, loops, manifests, and history catalogs to Cloudflare R2, S3-compatible storage, or a CDN. The MapLibre viewer and playback controls can remain unchanged.
