import { OpenAPIRoute } from "chanfana";
import { Env, type AppContext } from "../types";
import { supabaseClient } from "../lib/supabase";
import { generateAnalyticsQuery } from "../utils/analytics";

export class AnalyticsProcessingJob extends OpenAPIRoute {
  schema = {
    tags: ["Analytics"],
    summary: "Analytics Processing Job",
  };

  async handle(env: Env, type: "all" | "daily") {
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);

    let startDateIsosString: string;

    if (type === "all") {
      startDateIsosString = "2025-09-01T00:00:00.000Z";
    } else {
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      startDateIsosString = startDate.toISOString();
    }

    const startTime = Date.now();
    const supabase = supabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

    try {
      if (
        !env.POSTHOG_API_KEY ||
        !env.POSTHOG_PROJECT_ID ||
        !env.NEXT_PUBLIC_POSTHOG_HOST
      ) {
        console.error("Missing required environment variables");
        return console.error(
          { error: "Missing PostHog configuration" },
          { status: 500 }
        );
      }

      const analyticsQuery = generateAnalyticsQuery(
        startDateIsosString,
        endDate.toISOString(),
        env.NODE_ENV
      );

      const res = await fetch(
        `${env.NEXT_PUBLIC_POSTHOG_HOST}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`,
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
        }
      );

      if (!res.ok) {
        console.error(`PostHog API error: ${res.status} ${res.statusText}`);
        return console.error(
          { error: "PostHog API request failed", status: res.status },
          { status: 500 }
        );
      }

      const eventsData: any = await res.json();

      if (!eventsData.results || !Array.isArray(eventsData.results)) {
        console.error("Invalid PostHog response structure");
        return console.log(
          { error: "Invalid PostHog response" },
          { status: 500 }
        );
      }

      const analyticsData = eventsData.results
        .map(([date, current_url, pageview_count, unique_visitors]) => {
          const clean_url = current_url?.split("?")[0] || current_url;
          return {
            date,
            current_url: clean_url,
            pageview_count,
            unique_visitors,
          };
        })
        .filter(
          (item) => !(item.pageview_count === 0 && item.unique_visitors === 0)
        );

      const catalogueNames = [
        ...new Set(
          analyticsData
            .map((item) => {
              const match = item.current_url.match(/\/catalogues\/([^/]+)/);
              return match ? match[1] : null;
            })
            .filter(Boolean)
        ),
      ];

      const { data: catalogues, error: catalogueError } = await supabase
        .from("catalogues")
        .select("name, created_by")
        .in("name", catalogueNames);

      let unmatchedUrls = 0;
      const nameToUserId: Record<string, string> = {};
      (catalogues || []).forEach((r) => {
        nameToUserId[r.name.trim().toLowerCase()] = r.created_by;
      });

      const analyticsDataWithUserId = analyticsData
        .map((item) => {
          const match = item.current_url.match(/\/catalogues\/([^/]+)/);
          const restaurantName = match ? match[1].trim().toLowerCase() : null;

          const user_id = restaurantName
            ? nameToUserId[restaurantName] ?? null
            : null;

          return { ...item, user_id };
        })
        .filter((item) => item.user_id !== null);

      const { data: insertedData, error: insertError } = await supabase
        .from("analytics")
        .upsert(analyticsDataWithUserId, {
          onConflict: "date,current_url",
          ignoreDuplicates: true,
        })
        .select();

      const executionTime = Date.now() - startTime;

      const response = {
        message: "Analytics data inserted successfully",
        period: {
          startDate: startDateIsosString,
          endDate: endDate.toISOString(),
        },
        summary: {
          fetched: analyticsDataWithUserId.length,
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
        { status: 500 }
      );
    }
  }
}
