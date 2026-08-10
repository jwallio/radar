# WallCloud weather dashboard decisions

## 2026-08-09 — Public MRMS and ERA5 archive generation

- Allow the website to start bounded MRMS and ERA5 archive jobs without a visitor password or control key.
- Keep KRAX history, live Level II polling, and storm-focus mutations behind `POLLING_CONTROL_TOKEN`.
- Keep `ADMIN_SERVICE_TOKEN` private and required between the Cloudflare Worker and Cloud Run; public browser access does not make the Cloud Run admin service unauthenticated internally.
- Accept variable usage from anonymous uncached requests. Retain Cloud Run validation, request limits, cache reuse, and the one-active-ERA5 lock; add platform rate limiting before exposing the generator to sustained untrusted traffic.

## 2026-08-08 — Context pack and verification contract

- Use frontend typecheck, Python tests, production build, control-worker checks, and browser inspection as separate evidence classes.
- Preserve MRMS provenance, timestamps, manifests, generated radar artifacts, stale states, and fallback semantics.
- Keep deployment and production-data publication outside automatic verification.
- No source behavior, dependency, deployment, commit, or push change is implied by this context pack.

## Not documented

- The currently active production deployment path and owner are not consolidated in the inspected repository files.
