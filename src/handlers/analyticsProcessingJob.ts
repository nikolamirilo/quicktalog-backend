import { OpenAPIRoute } from "chanfana";
import { Env } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import {
  errorMessage,
  isoDay,
  logJob,
  missingAnalyticsConfig,
  shiftDay,
  syncAnalytics,
} from "../utils/analytics";

/**
 * Whole days imported again on every run, ending yesterday. Each day is overwritten with its
 * final totals on the runs after it ends, and an outage shorter than this heals by itself;
 * a longer one needs `POST /api/analytics/backfill`.
 */
const LOOKBACK_DAYS = 3;

export class AnalyticsProcessingJob extends OpenAPIRoute {
  schema = {
    tags: ["Analytics"],
    summary: "Analytics Processing Job",
  };

  /** Throws when the import fails, so the cron run shows as failed in the Workers dashboard. */
  async handle(env: Env) {
    const startTime = Date.now();
    const end = isoDay(new Date());
    const start = shiftDay(end, -LOOKBACK_DAYS);

    // Without the Supabase settings nothing reaches job_logs: the Workers logs and the
    // failed cron event are the only trace, so fail loudly here.
    const missingSupabase = missingAnalyticsConfig(env).filter((key) =>
      key.startsWith("SUPABASE_"),
    );
    if (missingSupabase.length > 0) {
      throw new Error(
        `Analytics job cannot run, missing worker settings: ${missingSupabase.join(", ")}`,
      );
    }
    const supabase = supabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    try {
      const missing = missingAnalyticsConfig(env);
      if (missing.length > 0) {
        throw new Error(`Missing worker settings: ${missing.join(", ")}`);
      }

      const result = await syncAnalytics(env, supabase, { start, end });
      const response = {
        message: "Analytics data imported successfully",
        period: { startDate: start, endDate: end },
        summary: {
          fetched: result.rows,
          inserted: result.written,
          pageviews: result.pageviews,
          unmatched_urls: result.unmatched_urls,
          unmatched_slugs: result.unmatched_slugs.slice(0, 50),
        },
        by_day: result.by_day,
      };

      await logJob(supabase, "analytics", "success", Date.now() - startTime, response);
      console.log(response);
    } catch (error) {
      console.error("Error occurred in analytics job:", error);
      await logJob(supabase, "analytics", "failure", Date.now() - startTime, {
        period: { startDate: start, endDate: end },
        error: errorMessage(error),
      });
      throw error;
    }
  }
}
