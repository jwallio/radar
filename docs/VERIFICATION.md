# WallCloud weather dashboard verification

## Default safe check

```powershell
.\scripts\verify-project.ps1
```

Default mode runs the frontend TypeScript check and Python tests. It does not build, deploy, publish data, start a worker, commit, or push.

## Full local check

```powershell
.\scripts\verify-project.ps1 -Full
```

Full mode adds the Vite production build, control-worker type checks, and control-worker authorization tests. It remains local and never deploys.

## Focused checks

```powershell
npm run typecheck
npm run build
python -m pytest -q
npm --prefix control_worker run types:check
npm --prefix control_worker run typecheck
npm --prefix control_worker test
```

## Browser verification

After a frontend or data-contract change, run the local app and inspect the intended route in a browser. Check map load, source/timestamp display, latest/stale/fallback states, playback controls, representative radar frames, and error/loading behavior. Record the route and build used. A build passing alone is not browser verification.

## Data and deployment boundaries

- Verify manifests and representative generated paths without replacing production data.
- Keep NOAA/NCEP MRMS source identity and timestamps visible and accurate.
- Do not run Cloudflare/Vercel/GitHub/Cloud Run deployment commands as part of this contract.

## Evidence to report

Record exact commands, Node/Python versions, build/test results, worker checks, browser route/state checks, generated artifact paths, and any unavailable data or external service limitation.
