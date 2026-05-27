# Weather Map Foundation Phases 1-3 Implementation Plan

Goal: Make the weather map the priority surface by adding basemap switching, a reversible Level2 radar provider scaffold, and stronger local alert zoom controls.

Architecture: Keep the active WeatherCommandCenter shell and MapView. Add small typed state/config/service abstractions so external basemaps and Level2 radar can be enabled by environment without breaking the default black/RainViewer experience. Keep Level2 as an API/tile contract scaffold until the Rust backend endpoint is available.

Tech Stack: React, TypeScript, Zustand, TanStack Query, MapLibre GL, Vite environment configuration.

## Phase 1: Basemap modes
- Add BasemapMode types and config entries for black, Bing/Google road, and Bing/Google satellite templates.
- Add map store state/actions for selected basemap mode and persist it locally.
- Switch the MapLibre raster basemap source/layer when mode changes.
- Add operator controls in WeatherLayerRail.

## Phase 2: Radar provider abstraction
- Add RadarProvider and normalized RadarState/RadarFrame types.
- Add a radar service wrapper that fetches RainViewer or Level2 metadata based on selected provider.
- Level2 uses configurable env endpoints/templates and degrades cleanly when missing.
- Scope React Query keys by provider and surface provider status/fallback in the radar dock.
- Add provider controls in the radar dock.

## Phase 3: Local alert zoom
- Add a visible map operations panel even when no alert is selected.
- Add Zoom active local alerts / Zoom CONUS alerts and Back to extent controls.
- Improve fit-bounds padding/max zoom for local response.
- Keep polygon -> affected zone fallback and no-dead-end behavior.

## Validation
Run npm run typecheck, npm run build, and npm run lint. Fix all failures before commit.
