/**
 * Re-imports catalogue page views from PostHog into the `analytics` table for a range of
 * days: to fill a gap left by a stopped cron, or to correct days the daily job imported
 * part-way through. Each day is overwritten with its full totals, so it is safe to run again.
 *
 * Dry run by default (reads PostHog and Supabase, writes nothing); add --apply to write.
 * Run `npm run backfill:analytics -- --help` for usage.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { unstable_readConfig } from "wrangler";
import { supabaseAdmin } from "../src/lib/supabase";
import {
  type AnalyticsConfig,
  type DayTotals,
  assertDay,
  errorMessage,
  isoDay,
  logJob,
  missingAnalyticsConfig,
  shiftDay,
  syncAnalytics,
} from "../src/utils/analytics";

const USAGE = `
Usage:
  npm run backfill:analytics -- --env <prod|test> --from YYYY-MM-DD [--to YYYY-MM-DD] [--apply]

Options:
  --env         Worker environment in wrangler.jsonc; picks the Supabase project, PostHog
                project and site domain.
  --from        First day to import.
  --to          Last day to import (inclusive). Default: yesterday (UTC).
  --apply       Write to Supabase. Without it, only shows what would be written.
  --chunk-days  Days per PostHog query (default 7).
  --env-file    Read the secrets below from this file (KEY=value lines), e.g. .env.backfill.

Secrets, from the environment or --env-file (never from flags, to keep them out of shell history):
  SUPABASE_SECRET_KEY   Secret key (sb_secret_...) of that environment's Supabase project.
  POSTHOG_API_KEY       PostHog personal API key with the query:read scope.
`;

function exitWithUsage(message: string): never {
  console.error(`Error: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: {
        env: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        apply: { type: "boolean", default: false },
        "chunk-days": { type: "string", default: "7" },
        "env-file": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    });
    return values;
  } catch (error) {
    exitWithUsage(errorMessage(error));
  }
}

/** The non-secret settings of `env`, exactly as the deployed Worker gets them. */
function workerVars(env: string): Record<string, string> {
  const config = unstable_readConfig(
    { config: resolve(import.meta.dirname, "../wrangler.jsonc"), env },
    { hideWarnings: true },
  );
  if (config.vars?.ENVIRONMENT !== env) {
    exitWithUsage(`wrangler.jsonc has no "${env}" environment`);
  }
  return config.vars as Record<string, string>;
}

/** Page views per day already in `analytics` for `[start, end]`. */
async function currentPageviews(
  supabase: ReturnType<typeof supabaseAdmin>,
  start: string,
  end: string,
) {
  const byDay = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("analytics")
      .select("day, pageviews")
      .gte("day", start)
      .lte("day", end)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + (row.pageviews ?? 0));
    }
    if (!data || data.length < pageSize) return byDay;
  }
}

async function main() {
  const options = parseOptions();
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const env = options.env;
  if (env !== "prod" && env !== "test") exitWithUsage("--env must be prod or test");
  if (!options.from) exitWithUsage("--from is required");

  const today = isoDay(new Date());
  const from = options.from;
  const to = options.to ?? shiftDay(today, -1);
  try {
    assertDay(from, "--from");
    assertDay(to, "--to");
  } catch (error) {
    exitWithUsage(errorMessage(error));
  }
  if (from > to) exitWithUsage(`--from ${from} is after --to ${to}`);
  if (to >= today) {
    exitWithUsage(`--to must be before today (${today}, UTC): the daily job imports days once they are over`);
  }
  const chunkDays = Number(options["chunk-days"]);
  if (!Number.isInteger(chunkDays) || chunkDays < 1) {
    exitWithUsage("--chunk-days must be a positive whole number");
  }

  if (options["env-file"]) process.loadEnvFile(options["env-file"]);

  const vars = workerVars(env);
  const config: AnalyticsConfig = {
    SUPABASE_URL: vars.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "",
    POSTHOG_HOST: vars.POSTHOG_HOST,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY ?? "",
    POSTHOG_PROJECT_ID: vars.POSTHOG_PROJECT_ID,
    ENVIRONMENT: env,
  };
  const missing = missingAnalyticsConfig(config);
  if (missing.length > 0) exitWithUsage(`missing ${missing.join(", ")}`);

  const apply = options.apply;
  console.log(`Analytics backfill (${apply ? "APPLY: writing to Supabase" : "dry run: nothing is written"})`);
  console.log(`  environment: ${env}`);
  console.log(`  supabase:    ${config.SUPABASE_URL}`);
  console.log(`  posthog:     ${config.POSTHOG_HOST} project ${config.POSTHOG_PROJECT_ID}`);
  console.log(`  days:        ${from} .. ${to} (inclusive)\n`);

  const supabase = supabaseAdmin(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY);
  const startTime = Date.now();
  const before = await currentPageviews(supabase, from, to);

  const byDay: Record<string, DayTotals> = {};
  const unmatched = new Set<string>();
  let rows = 0;
  let written = 0;
  let unmatchedUrls = 0;

  try {
    const end = shiftDay(to, 1);
    for (let start = from; start < end; start = shiftDay(start, chunkDays)) {
      const chunkEnd = [shiftDay(start, chunkDays), end].sort()[0]!;
      const result = await syncAnalytics(config, supabase, {
        start,
        end: chunkEnd,
        dryRun: !apply,
      });
      console.log(
        `  ${start} .. ${shiftDay(chunkEnd, -1)}: ${result.posthog_rows} PostHog rows -> ` +
          `${result.rows} catalogue-days${apply ? `, ${result.written} written` : ""}`,
      );
      Object.assign(byDay, result.by_day);
      result.unmatched_slugs.forEach((slug) => unmatched.add(slug));
      rows += result.rows;
      written += result.written;
      unmatchedUrls += result.unmatched_urls;
    }
  } catch (error) {
    console.error(`\nBackfill failed: ${errorMessage(error)}`);
    if (apply) {
      await logJob(supabase, "analytics_backfill", "failure", Date.now() - startTime, {
        period: { startDate: from, endDate: to },
        written_before_failure: written,
        error: errorMessage(error),
      });
      console.error(`${written} rows were written before the failure; running it again is safe.`);
    }
    process.exit(1);
  }

  console.log("\n  day         catalogues  pageviews  visitors  pageviews now in DB");
  let total = 0;
  let totalBefore = 0;
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const totals = byDay[day] ?? { catalogues: 0, pageviews: 0, unique_visitors: 0 };
    const now = before.get(day) ?? 0;
    total += totals.pageviews;
    totalBefore += now;
    console.log(
      `  ${day}  ${String(totals.catalogues).padStart(10)}  ${String(totals.pageviews).padStart(9)}` +
        `  ${String(totals.unique_visitors).padStart(8)}  ${String(now).padStart(19)}`,
    );
  }
  console.log(`  ${"total".padEnd(10)}  ${String(rows).padStart(10)}  ${String(total).padStart(9)}  ${"".padStart(8)}  ${String(totalBefore).padStart(19)}`);

  if (unmatched.size > 0) {
    console.log(
      `\n${unmatchedUrls} PostHog URL rows match no catalogue (renamed or deleted since): ${[...unmatched].join(", ")}`,
    );
  }

  if (apply) {
    await logJob(supabase, "analytics_backfill", "success", Date.now() - startTime, {
      message: "Analytics backfill completed",
      period: { startDate: from, endDate: to },
      summary: { fetched: rows, inserted: written, pageviews: total, unmatched_urls: unmatchedUrls },
    });
    console.log(`\nDone: ${written} rows written for ${from} .. ${to}.`);
  } else {
    console.log("\nDry run: nothing was written. Run again with --apply to write these rows.");
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
