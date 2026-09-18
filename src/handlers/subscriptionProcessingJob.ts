import { OpenAPIRoute } from "chanfana";
import { Env } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import { tiers } from "@quicktalog/common";
import { revalidateData } from "../helpers";

const PAGE_SIZE = 1000;
// Matches the max batch accepted by the app's /api/revalidate route.
const REVALIDATE_BATCH_SIZE = 500;

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

function currentMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Sums this month's pageviews for one user, paging through analytics rows. */
async function monthlyPageviews(supabase: SupabaseAdmin, userId: string) {
  const { start, end } = currentMonthRange();
  let total = 0;
  let from = 0;
  while (true) {
    const { data: rows, error } = await supabase
      .from("analytics")
      .select("pageview_count")
      .eq("user_id", userId)
      .gte("date", start)
      .lt("date", end)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of rows ?? []) total += row.pageview_count ?? 0;
    if (!rows || rows.length < PAGE_SIZE) return total;
    from += PAGE_SIZE;
  }
}

export class SubscriptionProcessingJob extends OpenAPIRoute {
  schema = {
    tags: ["Subscription"],
    summary: "Daily subscription usage check",
  };

  async handle(env: Env) {
    try {
      const supabase = supabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

      // 1. Get all users that are not on the free tier
      const { data: users, error: userError } = await supabase
        .from("users")
        .select("id, plan_id")
        .neq("plan_id", tiers[0].priceId.month);

      if (userError) throw userError;
      if (!users?.length)
        return console.log({ success: true, result: "No users to check" });

      // 2. Compute each user's usage from the database and inactivate their
      //    catalogues when the plan's traffic limit is reached.
      const results = await Promise.allSettled(
        users.map(async (user) => {
          const matchedTier = tiers.find((tier) =>
            Object.values(tier.priceId).includes(user.plan_id),
          );
          if (!matchedTier)
            throw new Error(`Tier not found for user ${user.id}`);

          const pageviewCount = await monthlyPageviews(supabase, user.id);
          const { traffic_limit } = matchedTier.features;
          if (pageviewCount < traffic_limit) {
            return { userId: user.id, action: "no_update_needed", names: [] };
          }

          const { data: updated, error: updateError } = await supabase
            .from("catalogues")
            .update({ status: "inactive" })
            .eq("created_by", user.id)
            .eq("status", "active")
            .select("name");

          if (updateError) throw updateError;
          const names = (updated ?? []).map((row) => row.name as string);
          return { userId: user.id, action: "catalogues_inactivated", names };
        }),
      );

      // 3. Revalidate the catalogues that were just inactivated so their
      //    public pages stop being served from cache.
      const inactivatedNames = results.flatMap((r) =>
        r.status === "fulfilled" ? r.value.names : [],
      );
      for (let i = 0; i < inactivatedNames.length; i += REVALIDATE_BATCH_SIZE) {
        const names = inactivatedNames.slice(i, i + REVALIDATE_BATCH_SIZE);
        try {
          await revalidateData(env, { names, dashboard: true });
        } catch (err) {
          console.error("Revalidation after inactivation failed:", err);
        }
      }

      // 4. Collect and summarize results
      const summary = results.map((r) =>
        r.status === "fulfilled"
          ? {
              userId: r.value.userId,
              action: r.value.action,
              inactivated: r.value.names.length,
            }
          : { error: (r.reason as Error).message },
      );

      return console.log({ success: true, result: summary });
    } catch (err) {
      console.error("Error in DailySubscriptionCheck:", err);
      return console.log(
        { success: false, result: (err as Error).message },
        500,
      );
    }
  }
}
