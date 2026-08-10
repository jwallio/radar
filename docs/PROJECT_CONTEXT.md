# WallCloud weather dashboard project context

_Context pack created 2026-08-08 from `README.md`, package manifests, TypeScript/Python source, control-worker configuration, tests, and CI evidence._

## Purpose

WallCloud weather dashboard is the public radar product at `https://radar.wall.cloud`. It presents official NOAA/NCEP MRMS composite data through a Vite/TypeScript/React/MapLibre frontend and associated generated tile/manifest paths.

## Sources of truth

- Product, data sources, deployment boundaries, and operations: `README.md`.
- Frontend and map behavior: `src/`, `public/`, Vite and TypeScript configuration.
- Python processing/tests: Python source and `tests/`.
- Optional control API/worker: `control_worker/`.
- Package commands: `package.json` and `control_worker/package.json`.

## Architecture boundaries

- Frontend: Vite build, React UI, MapLibre rendering, playback and status presentation.
- Data/artifacts: generated radar products, PMTiles, manifests, and R2/GitHub Pages-facing paths.
- Control worker: optional Cloudflare worker for operational controls; it has separate type-generation and typecheck commands.
- Other documented runtimes include Cloud Run/VPS paths; deployment is not part of local verification.

## Product constraints

- Show source identity and freshness honestly.
- Preserve stale/fallback behavior and make missing data distinguishable from a valid zero or current product.
- Generated manifests are part of the public contract.

## Undocumented / needs confirmation

- The current production data-publisher owner and promotion approval path are not consolidated in one repository file.
- The exact active deployment path among the documented hosting options is not recorded in a single authoritative status file.
