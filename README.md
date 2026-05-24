# WallCloud Weather Dashboard

A clean weather operations MVP for wall.cloud. This project is a fresh React + TypeScript dashboard with a CONUS-focused map shell, layer toggles, and placeholder weather context panels.

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

Preview URL (default):

```text
http://localhost:5173
```

## Commands

```bash
npm run dev
npm run typecheck
npm run build
```

## MVP Scope

- Fullscreen dark map shell focused on CONUS
- Left NWS alerts placeholder panel
- Right SPC/radar context placeholder panel
- Weather layer toggle panel
- Preset buttons:
  - Radar Only
  - Severe Weather
  - SPC Outlook
  - Clean Map
- Typed layer/preset/source configuration
- Safe JSON fetch helper for external weather feeds

## Public Source Stubs

- NWS Alerts: `https://api.weather.gov/alerts/active?status=actual&message_type=alert`
- NOAA WWA polygons: `https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query`
- RainViewer metadata: `https://api.rainviewer.com/public/weather-maps.json`
- SPC reports CSV: `https://www.spc.noaa.gov/climo/reports/today_raw.csv`

