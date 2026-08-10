# Radar control Worker

This Cloudflare Worker is the browser-facing control proxy for the radar application. It:

- reads and changes the administrator-only Level II polling state;
- reads and changes the single administrator-selected, expiring MRMS storm-focus region;
- proxies public bounded MRMS/ERA5 requests and owner-authorized KRAX requests to the authenticated Cloud Run admin service;
- proxies historical job-status polling without exposing the Cloud Run service token.

Level II state is stored in `control/polling.json`; storm-focus state is stored separately in `control/focus.json`. `GET /control/status`, `GET /focus/status`, historical job-status requests, and MRMS/ERA5 `POST /history/jobs` requests are public. The existing `POLLING_CONTROL_TOKEN` is required for `POST /control/polling`, `POST /focus/polling`, and KRAX `POST /history/jobs` requests.

Storm focus accepts one region only. A new selection replaces the previous region, is limited to a 25° × 20° box inside CONUS, and expires after 12 hours by default. Scheduler changes and KRAX history retain the owner-key guardrail. Public MRMS/ERA5 generation relies on geographic, duration, source, frame-count, cache, and ERA5 active-job limits; Cloud Run repeats the authoritative validation.

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

The Worker must be deployed by an account that can access the existing R2 bucket. Do not put `POLLING_CONTROL_TOKEN` in the repository, GitHub Pages build variables, or any `VITE_*` value. The browser does not need this token for MRMS or ERA5 generation.

ERA5 history requests are public. The Worker rejects global-looking requests early and allows at most a 70° longitude by 40° latitude processing-domain crop; Cloud Run performs the authoritative future-hour, whole-hour, seven-day, dataset, cache, and one-active-job validation again. Public generation can create Cloud Run, CDS, Worker, and R2 usage, so add a platform rate limiter before promoting the endpoint to an untrusted high-traffic audience.

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
