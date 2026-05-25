# wall.cloud Weather Monitor

A clean-room React + TypeScript weather operations dashboard for wall.cloud. The app is a map-first workspace for monitoring U.S. weather conditions with configurable modules, weather-operation presets, and public-source status visibility.

## Current Capabilities

- CONUS-focused MapLibre map shell with NWS alert polygons, SPC storm reports, SPC Day 1 outlook polygons, and RainViewer radar tiles.
- NWS active alerts rail with severity filters, mapped/unmapped indicators, polygon hover/click selection, and list-side Zoom to alert.
- SPC severe context module using public SPC storm reports and Day 1 outlook GeoJSON.
- RainViewer radar context module with frame stepping, playback, speed, and opacity controls.
- Live Context module with outbound weather-operation links only; no embedded camera, scanner, or news feeds are claimed.
- Customizable workspace modules with show/hide controls, zone selectors, native drag/drop movement, and localStorage persistence.
- Workspace presets for severe nowcasting, outbreak monitoring, clean radar, local operations, and source-health review.
- Source Health module for wired sources: NWS Alerts, SPC reports, SPC outlook, and RainViewer radar metadata.

## Data Sources

- NWS Alerts: `https://api.weather.gov/alerts/active?status=actual&message_type=alert`
- SPC storm reports CSV: `https://www.spc.noaa.gov/climo/reports/today_raw.csv`
- SPC Day 1 outlook GeoJSON: public SPC GIS endpoint configured in `src/config/links.ts`
- RainViewer radar metadata: `https://api.rainviewer.com/public/weather-maps.json`

The dashboard calls these public sources directly from the browser. It does not assume wall.cloud hosts backend weather APIs.

## Placeholder Modules

Weather Cameras, Scanner Links, and Weather News are intentionally labeled as future modules. They do not embed live streams, audio, or news feeds in the current build.

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
