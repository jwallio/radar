# WallCloud weather dashboard decisions

## 2026-08-08 — Context pack and verification contract

- Use frontend typecheck, Python tests, production build, control-worker checks, and browser inspection as separate evidence classes.
- Preserve MRMS provenance, timestamps, manifests, generated radar artifacts, stale states, and fallback semantics.
- Keep deployment and production-data publication outside automatic verification.
- No source behavior, dependency, deployment, commit, or push change is implied by this context pack.

## Not documented

- The currently active production deployment path and owner are not consolidated in the inspected repository files.
