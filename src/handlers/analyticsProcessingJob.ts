import { OpenAPIRoute } from "chanfana";
import { Env } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import { generateAnalyticsQuery } from "../utils/analytics";

export class AnalyticsProcessingJob extends OpenAPIRoute {
  schema = {
    tags: ["Analytics"],
    summary: "Analytics Processing Job",
  };

  async handle(env: Env, type: "all" | "daily") {
    const endDate = new Date();
    //endDate.setHours(0, 0, 0, 0);

    let startDateIsosString: string;

    if (type === "all") {
      startDateIsosString = "2025-09-01T00:00:00.000Z";
    } else {
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 1);
      //startDate.setHours(0, 0, 0, 0);
      startDateIsosString = startDate.toISOString();
    }

    const startTime = Date.now();
    const supabase = supabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    try {
      if (
        !env.POSTHOG_API_KEY ||
        !env.POSTHOG_PROJECT_ID ||
        !env.POSTHOG_HOST
      ) {
        console.error("Missing required environment variables");
        return console.error(
          { error: "Missing PostHog configuration" },
          { status: 500 },
        );
      }

      const analyticsQuery = generateAnalyticsQuery(
        startDateIsosString,
        endDate.toISOString(),
        env.ENVIRONMENT,
      );

      const res = await fetch(
        `${env.POSTHOG_HOST}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.POSTHOG_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: {
              kind: "HogQLQuery",
              query: analyticsQuery,
            },
          }),
          cache: "no-store",
        },
      );

      if (!res.ok) {
        console.error(`PostHog API error: ${res.status} ${res.statusText}`);
        return console.error(
          { error: "PostHog API request failed", status: res.status },
          { status: 500 },
        );
      }

      const eventsData: any = await res.json();

      if (!eventsData.results || !Array.isArray(eventsData.results)) {
        console.error("Invalid PostHog response structure");
        return console.log(
          { error: "Invalid PostHog response" },
          { status: 500 },
        );
      }

      const slugOf = (url: string) =>
        url.match(/\/catalogues\/([^/?#]+)/)?.[1]?.trim().toLowerCase() ?? null;

      const analyticsData = eventsData.results
        .map(([date, current_url, pageview_count, unique_visitors]) => ({
          day: String(date).slice(0, 10),
          slug: current_url ? slugOf(current_url) : null,
          pageviews: Number(pageview_count) || 0,
          unique_visitors: Number(unique_visitors) || 0,
        }))
        .filter((item) => item.pageviews > 0 || item.unique_visitors > 0);

      const slugs = [
        ...new Set(analyticsData.map((item) => item.slug).filter(Boolean)),
      ] as string[];

      const { data: catalogues, error: catalogueError } = await supabase
        .from("catalogues")
        .select("id, name, user_id")
        .in("name", slugs);
      if (catalogueError) throw catalogueError;

      const bySlug = new Map(
        (catalogues ?? []).map((row) => [row.name as string, row]),
      );

      // One row per catalogue per day: URL variants of a page are summed, so
      // visitors are an upper bound, as in the migration that merged them.
      let unmatchedUrls = 0;
      const rows = new Map<
        string,
        {
          day: string;
          catalogue_id: string;
          user_id: string;
          pageviews: number;
          unique_visitors: number;
        }
      >();
      for (const item of analyticsData) {
        const catalogue = item.slug ? bySlug.get(item.slug) : undefined;
        if (!catalogue) {
          unmatchedUrls++;
          continue;
        }
        const key = `${catalogue.id}|${item.day}`;
        const row = rows.get(key);
        if (row) {
          row.pageviews += item.pageviews;
          row.unique_visitors += item.unique_visitors;
        } else {
          rows.set(key, {
            day: item.day,
            catalogue_id: catalogue.id as string,
            user_id: catalogue.user_id as string,
            pageviews: item.pageviews,
            unique_visitors: item.unique_visitors,
          });
        }
      }
      const analyticsRows = [...rows.values()];

      const { data: insertedData, error: insertError } = await supabase
        .from("analytics")
        .upsert(analyticsRows, {
          onConflict: "catalogue_id,day",
          ignoreDuplicates: true,
        })
        .select();
      if (insertError) throw insertError;

      const executionTime = Date.now() - startTime;

      const response = {
        message: "Analytics data inserted successfully",
        period: {
          startDate: startDateIsosString,
          endDate: endDate.toISOString(),
        },
        summary: {
          fetched: analyticsRows.length,
          inserted: insertedData?.length || 0,
          unmatched_urls: unmatchedUrls,
        },
      };

      await supabase.from("job_logs").insert({
        job_name: "analytics",
        status: "success",
        execution_time_ms: executionTime,
        log: response,
      });

      return console.log(response, { status: 200 });
    } catch (error) {
      console.error("Error occured in analytics job:", error);
      await supabase.from("job_logs").insert({
        job_name: "analytics",
        status: "failure",
        execution_time_ms: Date.now() - startTime,
        log: error instanceof Error ? error.message : String(error),
      });
      return console.error(
        { error: "Error occurred while cing analytics" },
        { status: 500 },
      );
    }
  }
}
