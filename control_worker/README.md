# Radar polling control Worker

This small Cloudflare Worker is the protected control plane for the five-minute VPS radar refresh. It stores one JSON state object in the existing `wallcloud-radar-data` R2 bucket:

```json
{ "enabled": false, "updated_at": null }
```

The public site can read `GET /control/status`. Only callers with the `POLLING_CONTROL_TOKEN` secret can `POST /control/polling` with `{ "enabled": true|false }`. The VPS worker checks the status before starting MRMS or KRAX processing and fails closed if the configured control endpoint cannot be read.

## Deploy

From PowerShell:

```powershell
cd D:\weather-projects\wallcloud-weather-dashboard\control_worker
npm install
npx wrangler login
npx wrangler secret put POLLING_CONTROL_TOKEN
npx wrangler deploy
```

The deploy prints a `workers.dev` URL. Use that URL with `/control` while testing, or attach a custom domain such as `control.radar.wall.cloud` in Cloudflare Workers & Pages. Then set:

- GitHub repository variable `RADAR_CONTROL_API_URL` to the Worker origin, without a trailing slash.
- `/etc/wallcloud-radar.env` value `RADAR_CONTROL_STATUS_URL` to the same origin plus `/control/status`.

The Worker must be deployed by an account that can access the existing R2 bucket. Do not put `POLLING_CONTROL_TOKEN` in the repository, GitHub Pages build variables, or any `VITE_*` value.

## Connect the Cloud Run admin service

After deploying `wallcloud-radar-admin`, set the Worker variable and secret:

```powershell
npx wrangler secret put ADMIN_SERVICE_TOKEN
npx wrangler deploy
```

Set `ADMIN_SERVICE_URL` in `wrangler.jsonc` to the Cloud Run service URL before deploying. The token must match the `ADMIN_SERVICE_TOKEN` Secret Manager value used by the admin service. With that variable present, the Worker proxies authenticated live pause/resume requests and historical job requests to Cloud Run; without it, the live endpoint remains a state-only bootstrap mode and historical requests return a clear configuration error.

## Local test

```powershell
npm run typecheck
npx wrangler dev
```

Remote R2 writes are not used by local development unless Wrangler is explicitly started with `--remote`. The missing state defaults to polling disabled, which is the cost-safe production default.
