import { Bool, OpenAPIRoute } from "chanfana";
import z from "zod";
import { type AppContext } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import {
  errorMessage,
  firstPageviewDay,
  isoDay,
  logJob,
  missingAnalyticsConfig,
  shiftDay,
  syncAnalytics,
} from "../utils/analytics";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a day as YYYY-MM-DD")
  .refine((value) => shiftDay(value, 0) === value, "Not a calendar day");

const dayTotals = z.object({
  catalogues: z.number(),
  pageviews: z.number(),
  unique_visitors: z.number(),
});

/**
 * Re-imports catalogue page views from PostHog into `analytics` for a range of whole days,
 * overwriting each day with its totals: fills gaps the daily job left, and corrects days it
 * imported part-way through. Safe to repeat.
 */
export class AnalyticsBackfill extends OpenAPIRoute {
  schema = {
    tags: ["Analytics"],
    summary: "Backfill catalogue page views from PostHog",
    description:
      "With no parameters, re-imports every day from the first catalogue page view in PostHog up to yesterday (UTC). Existing rows are overwritten with each day's totals.",
    request: {
      query: z.object({
        start: day
          .optional()
          .describe("First day to import. Default: the first day PostHog has a catalogue page view."),
        end: day
          .optional()
          .describe("Last day to import, inclusive. Default: yesterday (UTC). Must be before today."),
        dryRun: z
          .enum(["true", "false"])
          .optional()
          .default("false")
          .transform((value) => value === "true")
          .describe("true: read and count, write nothing."),
      }),
    },
    responses: {
      200: {
        description: "The days imported, with totals per day.",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              dryRun: z.boolean(),
              period: z.object({ start: z.string(), end: z.string() }).nullable(),
              summary: z.object({
                posthog_rows: z.number(),
                rows: z.number(),
                written: z.number(),
                pageviews: z.number(),
                unmatched_urls: z.number(),
                unmatched_slugs: z.array(z.string()),
              }),
              by_day: z.record(z.string(), dayTotals),
            }),
          },
        },
      },
      400: { description: "Invalid range." },
      500: { description: "Missing worker settings, or PostHog or Supabase failed." },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { dryRun } = query;
    const env = c.env;

    const missing = missingAnalyticsConfig(env);
    if (missing.length > 0) {
      return c.json({ success: false, error: `Missing worker settings: ${missing.join(", ")}` }, 500);
    }

    const today = isoDay(new Date());
    const end = query.end ?? shiftDay(today, -1);
    if (end >= today) {
      return c.json(
        { success: false, error: `end must be before today (${today}, UTC): a day is imported once it is over` },
        400,
      );
    }
    if (query.start && query.start > end) {
      return c.json({ success: false, error: `start ${query.start} is after end ${end}` }, 400);
    }

    const startTime = Date.now();
    const supabase = supabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
    let start = query.start;

    try {
      start ??= (await firstPageviewDay(env)) ?? undefined;
      if (!start || start > end) {
        return c.json({
          success: true,
          dryRun,
          period: null,
          message: "PostHog has no catalogue page views up to yesterday: nothing to import",
          summary: { posthog_rows: 0, rows: 0, written: 0, pageviews: 0, unmatched_urls: 0, unmatched_slugs: [] },
          by_day: {},
        });
      }

      const result = await syncAnalytics(env, supabase, {
        start,
        end: shiftDay(end, 1),
        dryRun,
      });
      const summary = {
        posthog_rows: result.posthog_rows,
        rows: result.rows,
        written: result.written,
        pageviews: result.pageviews,
        unmatched_urls: result.unmatched_urls,
        unmatched_slugs: result.unmatched_slugs,
      };

      if (!dryRun) {
        await logJob(supabase, "analytics_backfill", "success", Date.now() - startTime, {
          message: "Analytics backfill completed",
          period: { startDate: start, endDate: end },
          summary,
        });
      }
      return c.json({ success: true, dryRun, period: { start, end }, summary, by_day: result.by_day });
    } catch (error) {
      console.error("Analytics backfill failed:", error);
      if (!dryRun) {
        await logJob(supabase, "analytics_backfill", "failure", Date.now() - startTime, {
          period: { startDate: start ?? null, endDate: end },
          error: errorMessage(error),
        });
      }
      return c.json(
        {
          success: false,
          error: errorMessage(error),
          hint: "Some days may have been written; running the same request again is safe.",
        },
        500,
      );
    }
  }
}
