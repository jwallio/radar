# Wall Cloud Radar

Wall Cloud Radar is a static-build-compatible North Carolina radar viewer for `radar.wall.cloud`. It centers the map on North Carolina while keeping southern Virginia, eastern Tennessee, northern South Carolina, and nearby Atlantic waters in view.

The MVP provides:

- NOAA/NCEP MRMS regional composite-reflectivity imagery processed to PNG.
- A KRAX-only NOAA NEXRAD Level II source with recent completed-volume playback and selectable historical packs.
- A generated manifest and recent-frame playback with previous, play/pause, next, scrubber, and 2/4/8/20/30 FPS choices using exact observed frames.
- Downloadable, branded animated GIF loops generated with the same Wall Cloud palette at a concise five-to-six-frame-per-second presentation rate.
- Client-side **Save GIF** export that follows the current map zoom/pan and selected viewer FPS, composes every frame from the radar raster plus local state/county/city vectors, and adds share-ready Wall Cloud framing with each frame's Eastern valid time and product legend. External basemap capture is only a last-resort fallback.
- Selectable historical loop packs sourced from NOAA's public MRMS archive.
- A second precipitation-type mode backed by the official MRMS PrecipFlag product when it decodes successfully.
- A product selector for composite reflectivity, PrecipFlag, and one-hour MRMS rainfall, plus latest-analysis overlays for 0–2 km and 3–6 km azimuthal shear, 30-minute rotation tracks, MESH, POSH, and five-minute NLDN cloud-to-ground lightning density.
- Clickable NWS surface observations and NOAA NDBC buoy observations, refreshed independently from radar playback.
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

KRAX Level II follows the same server-side contract:

```text
NOAA/Unidata public NEXRAD Level II archive (KRAX only)
        ↓
Python + Py-ART (discover → download → decode lowest sweep → project → PNG)
        ↓
public/data/radar/krax/frames + loops + history + manifests
        ↓
The existing MapLibre viewer, animation controls, and GIF exporter
```

The current live KRAX mode polls the newest completed volume files from the archive bucket, which is updated as data becomes available. The real-time chunk bucket is centralized in configuration for a future lower-latency worker, but the browser never assembles chunks or decodes Level II files.

## Official data sources

Radar URLs are centralized in `radar_processing/config.py` and are based on the official MRMS directory listings:

- [MRMS 2D product directory](https://mrms.ncep.noaa.gov/2D/)
- [MergedReflectivityQCComposite](https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/)
- [PrecipFlag](https://mrms.ncep.noaa.gov/2D/PrecipFlag/)
- [MultiSensor_QPE_01H_Pass1](https://mrms.ncep.noaa.gov/2D/MultiSensor_QPE_01H_Pass1/)
- [MergedAzShear_0-2kmAGL](https://mrms.ncep.noaa.gov/2D/MergedAzShear_0-2kmAGL/)
- [MergedAzShear_3-6kmAGL](https://mrms.ncep.noaa.gov/2D/MergedAzShear_3-6kmAGL/)
- [RotationTrack30min](https://mrms.ncep.noaa.gov/2D/RotationTrack30min/)
- [MESH](https://mrms.ncep.noaa.gov/2D/MESH/)
- [POSH](https://mrms.ncep.noaa.gov/2D/POSH/)
- [NLDN_CG_005min_AvgDensity](https://mrms.ncep.noaa.gov/2D/NLDN_CG_005min_AvgDensity/)
- [NOAA MRMS archive on NODD/AWS](https://registry.opendata.aws/noaa-mrms-pds/)
- [NOAA NEXRAD Level II on AWS](https://registry.opendata.aws/noaa-nexrad/) — current archive bucket `unidata-nexrad-level2` and real-time chunk bucket `unidata-nexrad-level2-chunks`.
- [NOAA NCEI NEXRAD documentation](https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar)
- [NOAA NCEI decoding guidance](https://www.ncei.noaa.gov/products/radar/decoding-utilities-examples)
- [ARM Py-ART](https://arm-doe.github.io/pyart/) for Archive II decoding.
- [MRMS operational flag table](https://www.nssl.noaa.gov/projects/mrms/operational/tables.php)
- [NWS API documentation](https://www.weather.gov/documentation/services-web-api)
- [NWS active alerts endpoint](https://api.weather.gov/alerts/active)
- [NOAA NDBC active stations](https://www.ndbc.noaa.gov/activestations.xml) and [realtime station observations](https://www.ndbc.noaa.gov/docs/ndbc_web_data_guide.pdf)
- [Census TIGERweb State/County service](https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer)
- [Census TIGERweb Transportation service](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer)

The map uses light, label-free raster tiles from [CARTO](https://carto.com/basemaps/) with OpenStreetMap attribution. Wall Cloud owns the priority city/highway labels and overlays them once. NOAA/NWS and Census attribution is shown in the interface and documented here.

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

Generate the KRAX Level II source as well:

```powershell
python -m pip install -r requirements-nexrad.txt
python scripts/build_krax_radar.py
npm run dev
```

For a faster live smoke test, render only the latest completed volume:

```powershell
python scripts/build_krax_radar.py --max-frames 1 --retention-minutes 30
```

The dev server is available at `http://localhost:5173` by default. The processor uses a temporary directory for raw downloads and removes raw GRIB2 files after rendering. It writes only generated PNGs and the manifest to `public/data/radar`.

`build_radar_frames.py` also refreshes the optional static buoy feed at `public/data/observations/buoys.json`. To refresh that feed without downloading MRMS data:

```powershell
python scripts/build_buoy_observations.py
```

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
- `radar_processing/observations.py` — NOAA NDBC active-station filtering and realtime text parsing for the coastal buoy feed.
- `radar_processing/animation.py` — branded GIF composition with Census boundaries, city labels, valid times, and legends.
- `radar_processing/pipeline.py` — shared live/historical rendering and output rotation.
- `radar_processing/history.py` — historical dataset IDs and catalog maintenance.
- `radar_processing/manifest.py` — deterministic frame ordering, retention, missing-file filtering, stale detection, and atomic JSON replacement.
- `scripts/build_radar_frames.py` — orchestration and CLI.
- `scripts/build_buoy_observations.py` — standalone NDBC feed refresh CLI.
- `radar_processing/nexrad.py` — KRAX archive discovery, timestamp parsing, retries, sampling, and atomic downloads.
- `radar_processing/nexrad_rendering.py` — Py-ART Archive II decode and Web-Mercator-aligned lowest-sweep reflectivity rendering.
- `radar_processing/nexrad_pipeline.py` — KRAX frame rotation, branded loop composition, and atomic manifest generation.
- `scripts/build_krax_radar.py` — recent completed KRAX volume orchestration.
- `scripts/build_historical_krax.py` — timezone-aware archived KRAX pack generation.

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

Each successful run also writes `public/data/radar/loops/composite-reflectivity.gif` and, when available, `precipitation-type.gif`. These are branded, fixed Central North Carolina reference loops (`-83.3, 33.6, -74.8, 37.0`) with coastal North Carolina and nearby Atlantic waters included, sharp raster cropping from the regional source, a clean vector base map, collision-checked city labels, valid time, and product legends. Loop URLs receive a generated version key so a newly cropped loop is not hidden by a cached older regional GIF. The viewer's **Save GIF** button exports the current MapLibre viewport, including its current zoom/pan, in a 720-pixel-wide share frame with the same branded header/footer, border, `wall.cloud` wordmark, frame's Eastern and UTC valid time, product-specific legend, observed-frame count, and selected 2/4/8/20/30 FPS setting. It draws labels, borders, warnings, and optional highways from local vector data so exports remain complete even when external basemap tiles cannot be captured. The basemap is label-free, so priority city and optional highway labels are owned by the app and appear once. GIF timing is quantized to centiseconds by the GIF format; the 20 and 30 FPS options use the nearest representable delay. The separate **Branded loop** link remains available when a generated static loop exists.

Browser playback defaults to 4 FPS and always swaps exact observed MRMS frames directly. The 20 and 30 FPS options preload the complete active sequence for testing, but display refresh and image decoding can still limit the effective rate. No crossfaded or interpolated radar field is shown, written to the manifest, or exported to GIF.

KRAX playback uses the same exact-frame behavior. It defaults to 18 completed volumes or 90 minutes, whichever is smaller. Configure it with `NEXRAD_MAX_FRAMES`, `NEXRAD_RETENTION_MINUTES`, `NEXRAD_IMAGE_WIDTH`, and `NEXRAD_REGION_WEST/EAST/SOUTH/NORTH`.

Viewport GIF export is client-side and does not send radar data to a server. The normal export path uses the zoom/pan-cropped local radar raster plus local state/county/city/warning/highway geography; a browser map-canvas capture is retained only as a last-resort recovery path for a transient local raster failure.

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

## Historical KRAX Level II

KRAX archive packs use the public `unidata-nexrad-level2` bucket and do not require AWS credentials. Times must include a timezone; the CLI converts the request to UTC and the viewer displays each valid time in Eastern Time.

```powershell
python scripts/build_historical_krax.py `
  --start '2025-06-19T14:00:00-04:00' `
  --end '2025-06-19T15:30:00-04:00' `
  --label 'KRAX June 19, 2025' `
  --max-frames 30
npm run dev
```

Generated packs are written under `public/data/radar/krax/history/<dataset-id>/`, and the KRAX history catalog is updated atomically. In the viewer choose **KRAX Level II** under **Radar source**, then select the generated archive under **Loop source**. Ranges are limited to 24 hours per pack and 90 sampled frames to bound download, decode, and GIF costs.

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
    "PrecipFlag": { "status": "ready", "frames": [] },
    "MultiSensor_QPE_01H_Pass1": { "status": "ready", "frames": [] },
    "MESH": { "status": "ready", "frames": [] }
  }
}
```

The frontend uses relative frame URLs, so the same artifact works at a custom-domain root or a GitHub Pages project path. The seven storm-analysis products are latest-only overlays in the live MVP; the primary reflectivity and PrecipFlag products retain the animated sequence. Missing manifests, missing frame files, stale timestamps, partial PrecipFlag output, and unavailable analysis layers are surfaced as meaningful UI states.

KRAX uses the same schema at `public/data/radar/krax/manifest.json` with `source: "nexrad-level2"`, `site: "KRAX"`, and product `NEXRADLevel2BaseReflectivity`. Its independent history catalog lives at `public/data/radar/krax/history/catalog.json`.

## Testing

Run the focused Python tests with:

```powershell
python -m pytest -q tests/test_radar_processing.py
```

The tests cover chronological ordering, retention, missing frame handling, stale timestamps, regional bounds, two-dBZ palette spacing, analysis-product configuration and palette mapping, NDBC parsing, archive-list parsing, historical catalog updates, GIF animation output, and NOAA PrecipFlag category mapping. Live processor smoke testing verified official directory listings and decoded one current raster for each new MRMS analysis layer.

`tests/test_nexrad_processing.py` additionally covers KRAX filename/listing parsing, site enforcement, retention and sampling, geographic gate projection, manifest ordering, and the atomic KRAX output contract. A live smoke test requires network access:

```powershell
python scripts/build_krax_radar.py --max-frames 1 --retention-minutes 30
```

## GitHub Actions and Pages

`.github/workflows/radar-refresh.yml` targets a five-minute schedule, but GitHub Actions schedules are best-effort and should not be treated as guaranteed two-minute ingestion. Each run:

1. Installs Python GRIB2 dependencies.
2. Downloads and renders regional MRMS frames.
3. Builds the Vite site with those generated files.
4. Uploads and deploys one Pages artifact.

It never commits radar images to the repository. `.github/workflows/pages.yml` provides a normal source-code-to-GitHub-Pages deployment for pushes and manual runs; the scheduled workflow is the one that includes fresh generated radar data.

The scheduled refresh also attempts the KRAX Level II build after MRMS; a KRAX upstream or decode failure does not discard the working MRMS deployment. `.github/workflows/historical-krax.yml` accepts a timezone-aware start/end range, generates a KRAX archive pack, preserves both MRMS and KRAX history caches, and deploys the combined site. Level II dependencies are isolated in `requirements-nexrad.txt`.

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
- Derived storm-analysis layers are generated as the latest available frame only. They are not historical or animated yet; historical playback intentionally disables them so current analyses are never mixed into an old loop.
- Lightning uses official NLDN cloud-to-ground five-minute average density. It is not a total-cloud-lightning feed and should not be interpreted as a complete strike count.
- Surface observations use a bounded, sampled set of NWS stations to keep browser requests reasonable. Values may be delayed or missing at individual stations.
- NDBC buoy data is generated server-side into static JSON because the upstream station list/realtime text files are not a dependable browser-facing API. A failed buoy refresh leaves the layer unavailable without blocking radar deployment.
- NWS alerts are fetched client-side, so an ad-blocker, CORS issue, rate limit, or upstream outage can degrade warning refresh while leaving the last successful result visible.
- The static MVP uses CARTO raster basemap tiles and Census TIGERweb overlays at runtime. A future production deployment should proxy or cache these sources if traffic requires stronger availability guarantees.
- Client-side share GIFs prioritize broad browser-decoder compatibility over maximum compression; their size grows with the selected frame count. The pre-rendered **Branded loop** remains the smaller fixed-Central-NC option.
- GitHub Actions is not a real-time scheduler. A worker or persistent object-store pipeline is recommended for lower-latency updates.
- Historical packs available in the static viewer are generated selections, not arbitrary browser-side GRIB decoding. GitHub Actions caches preserve them for the MVP, but cache eviction can remove old packs; use R2/S3 for permanent public history.
- KRAX is a single radar rather than a quality-controlled mosaic. Beam height increases with range, terrain can block coverage, and biological propagation or ground clutter can appear in base reflectivity.
- KRAX live mode currently uses the latest completed archive volumes. Direct chunk assembly from `unidata-nexrad-level2-chunks` remains a future latency improvement for a persistent worker.
- Py-ART has a larger dependency footprint than the MRMS renderer. `requirements-nexrad.txt` keeps it isolated, and the Linux GitHub Actions runner is the reference deployment environment if a local Windows Python distribution lacks compatible wheels.
- Static GitHub Pages cannot launch arbitrary Python archive jobs from an anonymous browser request. The MVP provides local CLI and manual GitHub Actions archive generation; a Cloud Run/VPS worker plus durable object storage is required for true on-demand public date selection.

## Future migration path

The frontend consumes only `manifest.json` and relative/absolute raster URLs. A future worker can run `scripts/build_radar_frames.py` on Cloud Run, a small VPS, or a scheduled container, then upload the generated `frames/` and manifest to Cloudflare R2, S3-compatible storage, or another CDN. Change the manifest base URL or static hosting configuration; the MapLibre client and animation controls do not need to decode or understand GRIB2.
