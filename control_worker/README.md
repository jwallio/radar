# Radar control Worker

This Cloudflare Worker is the browser-facing control proxy for the radar application. It:

- reads and changes the administrator-only Level II polling state;
- reads and changes the single administrator-selected, expiring MRMS storm-focus region;
- proxies owner-authorized, bounded historical requests to the authenticated Cloud Run admin service;
- proxies historical job-status polling without exposing the Cloud Run service token.

Level II state is stored in `control/polling.json`; storm-focus state is stored separately in `control/focus.json`. `GET /control/status`, `GET /focus/status`, and historical job-status requests are public. The existing `POLLING_CONTROL_TOKEN` is required for `POST /control/polling`, `POST /focus/polling`, and `POST /history/jobs`.

Storm focus accepts one region only. A new selection replaces the previous region, is limited to a 25° × 20° box inside CONUS, and expires after 12 hours by default. Requiring the owner key before Scheduler changes or history creation is the primary cost guardrail; Cloud Run repeats the geographic, duration, source, and frame-count validation.

## Deploy

Wrangler 4 requires Node.js 22 or newer.

From PowerShell:

```powershell
cd D:\weather-projects\wallcloud-weather-dashboard\control_worker
npm install
npx wrangler types worker-configuration.d.ts --include-runtime false
npm run typecheck
npx wrangler login
npx wrangler secret put POLLING_CONTROL_TOKEN
npx wrangler deploy
```

The deploy prints a `workers.dev` URL. Use that URL while testing, or attach a custom domain such as `control.radar.wall.cloud` in Cloudflare Workers & Pages. Then set:

- GitHub repository variable `RADAR_CONTROL_API_URL` to the Worker origin, without a trailing slash.

The Worker must be deployed by an account that can access the existing R2 bucket. Do not put `POLLING_CONTROL_TOKEN` in the repository, GitHub Pages build variables, or any `VITE_*` value.

ERA5 history requests pass through the same owner-token boundary. The Worker rejects future/global-looking requests early and allows at most a 70° longitude by 40° latitude CONUS crop; Cloud Run performs the authoritative whole-hour, seven-day, and dataset validation again.

## Connect the Cloud Run admin service

After deploying `wallcloud-radar-admin`, set the Worker variable and secret:

```powershell
npx wrangler secret put ADMIN_SERVICE_TOKEN
npx wrangler deploy
```

Set `ADMIN_SERVICE_URL` in `wrangler.jsonc` to the Cloud Run service URL before deploying. The token must match the `ADMIN_SERVICE_TOKEN` Secret Manager value used by the admin service. Without that variable and secret, historical requests return a configuration error and polling controls can only change R2 state; they cannot safely resume or pause Cloud Scheduler.

## Local test

```powershell
npm run types:check
npm run typecheck
npx wrangler dev
```

Remote R2 writes are not used by local development unless Wrangler is explicitly started with `--remote`. The missing state defaults to polling disabled, which is the cost-safe production default.
