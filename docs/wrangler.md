## Deployment

- Test: `npx wrangler deploy --env test`
- Prod: `npx wrangler deploy --env prod`
- Develop locally: `npx wrangler dev --env test`

## API docs (Swagger)

- Swagger UI: `/` (e.g. https://backend.quicktalog.app/), spec at `/openapi.json`, ReDoc at `/redocs`.
- Every route, the docs included, needs `WORKER_ADMIN_TOKEN`. In a browser, the login prompt asks for it: any user name, the token as the password. "Try it out" then reuses that login; **Authorize** (bearer token) works too.
- Scripts send `Authorization: Bearer <token>`.

## Analytics

- The `0 3 * * *` cron re-imports the last 3 whole days of catalogue page views from PostHog, overwriting each day with its totals. A failed run is recorded in `job_logs` and marks the cron event as failed.
- `POST /api/analytics/backfill` re-imports a longer range the same way (bearer `WORKER_ADMIN_TOKEN`). Query parameters, all optional: `start`, `end` (inclusive, `YYYY-MM-DD`, before today) and `dryRun=true`. With no `start` it starts at the first catalogue page view in PostHog; with no `end` it stops at yesterday (UTC). Runs are recorded in `job_logs` as `analytics_backfill`.
  `curl -X POST -H "Authorization: Bearer $WORKER_ADMIN_TOKEN" "https://backend.quicktalog.app/api/analytics/backfill?dryRun=true"`
