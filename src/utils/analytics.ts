import { supabaseAdmin } from "../lib/supabase";
import type { Env } from "../types";

/** What the analytics import needs; the Worker's `Env` provides it. */
export type AnalyticsConfig = Pick<
  Env,
  | "SUPABASE_URL"
  | "SUPABASE_SECRET_KEY"
  | "POSTHOG_HOST"
  | "POSTHOG_API_KEY"
  | "POSTHOG_PROJECT_ID"
  | "ENVIRONMENT"
>;

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

/** Rows PostHog returns at most for one API query that sets its own LIMIT. */
export const POSTHOG_MAX_ROWS = 50_000;
/**
 * Days per PostHog query. A month of catalogue page views is a few thousand rows, far below
 * POSTHOG_MAX_ROWS, and a long import stays within a Free plan Worker's 50 subrequests.
 */
const QUERY_CHUNK_DAYS = 31;
const UPSERT_BATCH_SIZE = 1000;
// Names go into the request URL (`name=in.(...)`), so they are looked up in batches.
const CATALOGUE_LOOKUP_BATCH_SIZE = 100;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of a date, in UTC. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The day `days` days after `day` (before it, when negative). */
export function shiftDay(day: string, days: number) {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** Days from `start` up to, not including, `end`. */
const daysBetween = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);

/** Throws unless `day` is a real calendar day written `YYYY-MM-DD`. */
export function assertDay(day: string, label = "day") {
  if (!DAY_PATTERN.test(day) || shiftDay(day, 0) !== day) {
    throw new Error(`Invalid ${label} "${day}": expected YYYY-MM-DD`);
  }
}

/** The settings an import cannot run without; empty when all are there. */
export function missingAnalyticsConfig(config: Partial<AnalyticsConfig>) {
  const required: (keyof AnalyticsConfig)[] = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "POSTHOG_HOST",
    "POSTHOG_API_KEY",
    "POSTHOG_PROJECT_ID",
    "ENVIRONMENT",
  ];
  return required.filter((key) => !config[key]?.trim());
}

/** The page views that count: public catalogue pages on this environment's site. */
function cataloguePageviewFilter(env: string) {
  const domainFilter =
    env === "prod" ? "%www.quicktalog.app%" : "%test.quicktalog.app%";
  return `event = '$pageview'
      AND properties.$current_url NOT ILIKE '%admin%'
      AND properties.$current_url LIKE '%/catalogues/%'
      AND properties.$current_url NOT ILIKE '%localhost%'
      AND properties.$current_url ILIKE '${domainFilter}'`;
}

/**
 * Page views of public catalogue pages, per day and URL, for the whole days from `start` up
 * to, not including, `end`. A day is a calendar day in the PostHog project's timezone, as
 * `toDate(timestamp)` gives it, which is what every row already in `analytics` uses. The raw
 * `timestamp` bounds, a day wider on each side, only let ClickHouse skip partitions; the
 * `toDate` bounds decide which events count.
 */
export function generateAnalyticsQuery(
  start: string,
  end: string,
  env: string,
) {
  assertDay(start, "start day");
  assertDay(end, "end day");

  return `
    SELECT
      toDate(timestamp) AS date,
      properties.$current_url AS current_url,
      COUNT(*) AS pageview_count,
      COUNT(DISTINCT properties.distinct_id) AS unique_visitors
    FROM events
    WHERE ${cataloguePageviewFilter(env)}
      AND timestamp >= toDateTime('${start} 00:00:00', 'UTC') - INTERVAL 1 DAY
      AND timestamp < toDateTime('${end} 00:00:00', 'UTC') + INTERVAL 1 DAY
      AND toDate(timestamp) >= toDate('${start}')
      AND toDate(timestamp) < toDate('${end}')
    GROUP BY date, current_url
    ORDER BY date, current_url
    LIMIT ${POSTHOG_MAX_ROWS}
  `;
}

/** The day of the first catalogue page view PostHog has, or no row when there is none. */
export function generateFirstDayQuery(env: string) {
  return `
    SELECT toDate(timestamp) AS date
    FROM events
    WHERE ${cataloguePageviewFilter(env)}
    ORDER BY timestamp ASC
    LIMIT 1
  `;
}

/** Runs a HogQL query and returns its rows, and whether PostHog cut them off. */
async function runHogQL(config: AnalyticsConfig, query: string) {
  const host = config.POSTHOG_HOST.replace(/\/+$/, "");
  const res = await fetch(
    `${host}/api/projects/${config.POSTHOG_PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.POSTHOG_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `PostHog query failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`.trim(),
    );
  }

  const data: any = await res.json();
  if (!Array.isArray(data?.results)) {
    throw new Error("Invalid PostHog response: no results array");
  }
  const results = data.results as unknown[][];
  return {
    results,
    truncated: data.hasMore === true || results.length >= POSTHOG_MAX_ROWS,
  };
}

/** The first day with a catalogue page view in PostHog, or null when there is none. */
export async function firstPageviewDay(config: AnalyticsConfig) {
  const { results } = await runHogQL(config, generateFirstDayQuery(config.ENVIRONMENT));
  const first = results[0]?.[0];
  return first ? String(first).slice(0, 10) : null;
}

/** `[date, current_url, pageview_count, unique_visitors]`, as the query selects them. */
export type PosthogPageviewRow = [unknown, unknown, unknown, unknown];

/** One query's worth of `[start, end)`, halved until PostHog no longer cuts the result off. */
async function fetchWindow(
  config: AnalyticsConfig,
  start: string,
  end: string,
): Promise<PosthogPageviewRow[]> {
  const { results, truncated } = await runHogQL(
    config,
    generateAnalyticsQuery(start, end, config.ENVIRONMENT),
  );
  if (!truncated) return results as PosthogPageviewRow[];

  const days = daysBetween(start, end);
  if (days <= 1) {
    throw new Error(`PostHog returned over ${POSTHOG_MAX_ROWS} page URLs for ${start} alone`);
  }
  const middle = shiftDay(start, Math.floor(days / 2));
  const firstHalf = await fetchWindow(config, start, middle);
  return firstHalf.concat(await fetchWindow(config, middle, end));
}

/** Catalogue page views for the whole days `[start, end)`, queried a month at a time. */
export async function fetchCataloguePageviews(
  config: AnalyticsConfig,
  start: string,
  end: string,
): Promise<PosthogPageviewRow[]> {
  let rows: PosthogPageviewRow[] = [];
  for (let from = start; from < end; ) {
    const to = [shiftDay(from, QUERY_CHUNK_DAYS), end].sort()[0]!;
    rows = rows.concat(await fetchWindow(config, from, to));
    from = to;
  }
  return rows;
}

/** The catalogue slug of a public catalogue URL (`.../catalogues/<slug>`), lower-cased. */
export function catalogueSlug(url: string): string | null {
  const raw = url.match(/\/catalogues\/([^/?#]+)/)?.[1];
  if (!raw) return null;
  let slug = raw;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    // Malformed escape: keep the raw segment, it simply won't match a catalogue.
  }
  return slug.trim().toLowerCase() || null;
}

export type CatalogueRef = { id: string; name: string; user_id: string };

export type AnalyticsRow = {
  day: string;
  catalogue_id: string;
  user_id: string;
  pageviews: number;
  unique_visitors: number;
};

/**
 * One row per catalogue per day. URL variants of a page (query strings, trailing paths) are
 * summed, so visitors are an upper bound, as in the migration that merged them.
 */
export function buildAnalyticsRows(
  results: PosthogPageviewRow[],
  catalogues: Map<string, CatalogueRef>,
) {
  const rows = new Map<string, AnalyticsRow>();
  const unmatchedSlugs = new Set<string>();
  let unmatchedUrls = 0;

  for (const [date, currentUrl, pageviewCount, uniqueVisitors] of results) {
    const pageviews = Number(pageviewCount) || 0;
    const visitors = Number(uniqueVisitors) || 0;
    if (pageviews <= 0 && visitors <= 0) continue;

    const slug = typeof currentUrl === "string" ? catalogueSlug(currentUrl) : null;
    const catalogue = slug ? catalogues.get(slug) : undefined;
    if (!catalogue) {
      unmatchedUrls++;
      if (slug) unmatchedSlugs.add(slug);
      continue;
    }

    const day = String(date).slice(0, 10);
    const key = `${catalogue.id}|${day}`;
    const row = rows.get(key);
    if (row) {
      row.pageviews += pageviews;
      row.unique_visitors += visitors;
    } else {
      rows.set(key, {
        day,
        catalogue_id: catalogue.id,
        user_id: catalogue.user_id,
        pageviews,
        unique_visitors: visitors,
      });
    }
  }

  return {
    rows: [...rows.values()],
    unmatchedUrls,
    unmatchedSlugs: [...unmatchedSlugs].sort(),
  };
}

/** The catalogues whose name is one of `slugs`, by name. */
async function cataloguesBySlug(
  supabase: SupabaseAdmin,
  slugs: string[],
): Promise<Map<string, CatalogueRef>> {
  const bySlug = new Map<string, CatalogueRef>();
  for (let i = 0; i < slugs.length; i += CATALOGUE_LOOKUP_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("catalogues")
      .select("id, name, user_id")
      .in("name", slugs.slice(i, i + CATALOGUE_LOOKUP_BATCH_SIZE));
    if (error) throw error;
    for (const row of (data ?? []) as CatalogueRef[]) bySlug.set(row.name, row);
  }
  return bySlug;
}

export type DayTotals = { catalogues: number; pageviews: number; unique_visitors: number };

export type AnalyticsSyncResult = {
  /** First day imported. */
  start: string;
  /** Day after the last day imported. */
  end: string;
  posthog_rows: number;
  /** Catalogue-day rows built (and, unless a dry run, written). */
  rows: number;
  written: number;
  pageviews: number;
  unmatched_urls: number;
  /** Slugs seen in PostHog with no catalogue of that name (renamed or deleted since). */
  unmatched_slugs: string[];
  by_day: Record<string, DayTotals>;
};

/**
 * Imports catalogue page views for the whole days `[start, end)` from PostHog into
 * `analytics`. A row that exists is overwritten with the day's totals, so running it again
 * over the same days is safe and corrects days that were imported part-way through.
 */
export async function syncAnalytics(
  config: AnalyticsConfig,
  supabase: SupabaseAdmin,
  { start, end, dryRun = false }: { start: string; end: string; dryRun?: boolean },
): Promise<AnalyticsSyncResult> {
  assertDay(start, "start day");
  assertDay(end, "end day");
  if (start >= end) throw new Error(`Empty range: ${start} is not before ${end}`);

  const results = await fetchCataloguePageviews(config, start, end);

  const slugs = [
    ...new Set(
      results
        .map(([, url]) => (typeof url === "string" ? catalogueSlug(url) : null))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];
  const catalogues = await cataloguesBySlug(supabase, slugs);
  const { rows, unmatchedUrls, unmatchedSlugs } = buildAnalyticsRows(
    results,
    catalogues,
  );

  let written = 0;
  if (!dryRun) {
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const { error } = await supabase
        .from("analytics")
        .upsert(batch, { onConflict: "catalogue_id,day" });
      if (error) throw error;
      written += batch.length;
    }
  }

  const byDay: Record<string, DayTotals> = {};
  let pageviews = 0;
  for (const row of rows) {
    const totals = (byDay[row.day] ??= { catalogues: 0, pageviews: 0, unique_visitors: 0 });
    totals.catalogues++;
    totals.pageviews += row.pageviews;
    totals.unique_visitors += row.unique_visitors;
    pageviews += row.pageviews;
  }

  return {
    start,
    end,
    posthog_rows: results.length,
    rows: rows.length,
    written,
    pageviews,
    unmatched_urls: unmatchedUrls,
    unmatched_slugs: unmatchedSlugs,
    by_day: byDay,
  };
}

/** A readable message for anything thrown, including Supabase's plain error objects. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Records a run in `job_logs`. A failure to record is reported, never thrown. */
export async function logJob(
  supabase: SupabaseAdmin,
  jobName: string,
  status: "success" | "failure",
  executionTimeMs: number,
  log: unknown,
) {
  const { error } = await supabase.from("job_logs").insert({
    job_name: jobName,
    status,
    execution_time_ms: executionTimeMs,
    log,
  });
  if (error) console.error(`Could not write job_logs for ${jobName}:`, error);
}
