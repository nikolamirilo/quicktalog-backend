## Deployment

- Test: `npx wrangler deploy --env test`
- Prod: `npx wrangler deploy --env prod`
- Develop locally: `npx wrangler dev --env test`

## Analytics

- The `0 3 * * *` cron re-imports the last 3 whole days of catalogue page views from PostHog, overwriting each day with its totals. A failed run is recorded in `job_logs` and marks the cron event as failed.
- To fill a longer gap, dry run first, then add `--apply`:
  `npm run backfill:analytics -- --env prod --from 2026-10-22 --env-file .env.backfill`
  The file (gitignored by `.env*`) holds `SUPABASE_SECRET_KEY` and `POSTHOG_API_KEY`. See `--help`.
