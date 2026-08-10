# WallCloud weather dashboard guidance

## Before editing

- Read `docs/PROJECT_CONTEXT.md`, `docs/STATUS.md`, and `docs/VERIFICATION.md`.
- Capture the branch, commit, and dirty status. Treat generated radar manifests, frontend edits, and all existing artifacts as user-owned.
- Prefer the existing Vite, TypeScript, Python, control-worker, and browser verification paths.

## Project rules

- Preserve the public radar contract at `https://radar.wall.cloud`, including official NOAA/NCEP MRMS source labeling, timestamps, manifests, PMTiles/R2 paths, and stale/fallback states.
- Keep frontend, Python ingestion/processing, and the optional Cloudflare control worker boundaries explicit.
- Do not represent unavailable, stale, fallback, or retained radar data as current success.
- Treat generated radar data and manifests as product artifacts; do not rewrite or clean them during unrelated UI work.
- Browser verification must cover the intended route and the visible loading, freshness, stale/fallback, playback, and error states when affected.

## Change and release policy

Use focused checks first. Full builds and worker checks are local only. Do not deploy the site or worker, change production data, add dependencies, commit, or push unless explicitly requested.
