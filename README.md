# wall.cloud Weather Monitor

A clean-room React + TypeScript weather operations dashboard for wall.cloud. The app is a map-first workspace for monitoring U.S. weather conditions with configurable modules, weather-operation presets, and public-source status visibility.

## Current Capabilities

- CONUS-focused MapLibre map shell with NWS alert polygons, SPC storm reports, SPC Day 1 outlook polygons, and RainViewer radar tiles.
- NWS active alerts rail with severity filters, mapped/unmapped indicators, polygon hover/click selection, and list-side Zoom to alert.
- SPC severe context module using public SPC storm reports and Day 1 outlook GeoJSON.
- RainViewer radar context module with frame stepping, playback, speed, and opacity controls.
- Live Ops module with in-app streamer/scanner surfaces where embeddable sources are available, plus canonical external-link fallbacks when providers block embeds.
- Customizable workspace modules with show/hide controls, zone selectors, native drag/drop movement, and localStorage persistence.
- Workspace presets for severe nowcasting, outbreak monitoring, clean radar, local operations, and source-health review.
- Source Health module for wired sources: NWS Alerts, SPC reports, SPC outlook, and RainViewer radar metadata.

## Data Sources

- NWS Alerts: `https://api.weather.gov/alerts/active?status=actual&message_type=alert`
- SPC storm reports CSV: `https://www.spc.noaa.gov/climo/reports/today_raw.csv`
- SPC Day 1 outlook GeoJSON: public SPC GIS endpoint configured in `src/config/links.ts`
- RainViewer radar metadata: `https://api.rainviewer.com/public/weather-maps.json`

The dashboard calls these public sources directly from the browser. It does not assume wall.cloud hosts backend weather APIs.

## Integration Notes

Streamer, scanner, OpenMHz, and related live-operation sources are third-party embeds or outbound links. If an embed is blocked by the provider or browser policy, the dashboard should continue to show a status/fallback state and a canonical external link.

AI weather summaries are optional and disabled unless configured. For public static deployments, point `VITE_LLM_API_ENDPOINT` only at a non-secret proxy endpoint. Do not put API keys in any `VITE_*` variable because Vite exposes those values to client-side JavaScript.

## Stack

- React + TypeScript + Vite
- MapLibre GL
- TanStack Query
- Zustand

## Quick Start

```bash
npm install
npm run dev
```

Preview URL:

```text
http://localhost:5173
```

## Validation

```bash
npm run typecheck
npm run build
npm run lint
```

## Static Deployment

The app builds to a static `dist/` directory and is compatible with GitHub Pages and Cloudflare Pages. It does not require Railway, Supabase, auth, a database, or a hosted backend for the current public-source dashboard.

Cloudflare Pages settings:

```text
Build command: npm run build
Build output directory: dist
Environment variables: VITE_BASE_PATH=/
```

GitHub Pages project-site build:

```bash
VITE_BASE_PATH=wallcloud-weather-dashboard npm run build
```

Then publish the generated `dist/` directory with your preferred Pages workflow. For a user/organization site or custom domain served from the domain root, use `VITE_BASE_PATH=/`. The build also accepts `/wallcloud-weather-dashboard/` in Linux CI; the no-slash form is friendlier to Windows Git Bash path conversion.
