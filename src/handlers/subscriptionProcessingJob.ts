import { OpenAPIRoute } from "chanfana";
import { Env } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import { catalogueFitsPlan, misfitMessage, tiers } from "@quicktalog/common";
import { revalidateData } from "../helpers";

const PAGE_SIZE = 1000;
// Catalogue rows carry their whole content, so they are read in smaller pages.
const CATALOGUE_PAGE_SIZE = 200;
// Matches the max batch accepted by the app's /api/revalidate route.
const REVALIDATE_BATCH_SIZE = 500;

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

/** The current UTC month as `YYYY-MM-DD` days, end exclusive. */
function currentMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/** Sums this month's pageviews for one user, paging through analytics rows. */
async function monthlyPageviews(supabase: SupabaseAdmin, userId: string) {
  const { start, end } = currentMonthRange();
  let total = 0;
  let from = 0;
  while (true) {
    const { data: rows, error } = await supabase
      .from("analytics")
      .select("pageviews")
      .eq("user_id", userId)
      .gte("day", start)
      .lt("day", end)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of rows ?? []) total += row.pageviews ?? 0;
    if (!rows || rows.length < PAGE_SIZE) return total;
    from += PAGE_SIZE;
  }
}

type Tier = (typeof tiers)[number];

const tierFor = (planId: string | null): Tier =>
  tiers.find((tier) => Object.values(tier.priceId).includes(planId ?? "")) ??
  tiers[0];

/**
 * Switches off every active catalogue that no longer fits its owner's plan
 * (too many items or sections, or a block type the plan lacks) - what a
 * downgrade leaves behind. Covers every user, free plan included, since a
 * downgrade lands there. The app refuses switching it back on until it fits.
 */
async function deactivateMisfits(supabase: SupabaseAdmin) {
  const plans = new Map<string, string | null>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("users")
      .select("id, plan_id")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) plans.set(row.id, row.plan_id);
    if (!data || data.length < PAGE_SIZE) break;
  }

  const misfits: { id: string; userId: string; reason: string }[] = [];
  for (let from = 0; ; from += CATALOGUE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("catalogues")
      .select("id, user_id, content")
      .eq("status", "active")
      .order("id")
      .range(from, from + CATALOGUE_PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const tier = tierFor(plans.get(row.user_id) ?? null);
      const fit = catalogueFitsPlan(row.content, tier.features);
      if ("misfit" in fit) {
        misfits.push({
          id: row.id,
          userId: row.user_id,
          reason: misfitMessage(fit.misfit, tier.name),
        });
      }
    }
    if (!data || data.length < CATALOGUE_PAGE_SIZE) break;
  }

  const names: string[] = [];
  for (let i = 0; i < misfits.length; i += REVALIDATE_BATCH_SIZE) {
    const batch = misfits.slice(i, i + REVALIDATE_BATCH_SIZE);
    const { data, error } = await supabase
      .from("catalogues")
      .update({ status: "inactive" })
      .in(
        "id",
        batch.map((m) => m.id),
      )
      .eq("status", "active")
      .select("name");
    if (error) throw error;
    names.push(...(data ?? []).map((row) => row.name as string));
  }
  for (const m of misfits) {
    console.log({ action: "catalogue_over_plan", userId: m.userId, catalogueId: m.id, reason: m.reason });
  }
  return names;
}

export class SubscriptionProcessingJob extends OpenAPIRoute {
  schema = {
    tags: ["Subscription"],
    summary: "Subscription usage and plan-fit check",
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

      // 2. Compute each user's usage from the database and inactivate their
      //    catalogues when the plan's traffic limit is reached.
      const results = await Promise.allSettled(
        (users ?? []).map(async (user) => {
          const matchedTier = tiers.find((tier) =>
            Object.values(tier.priceId).includes(user.plan_id),
          );
          if (!matchedTier)
            throw new Error(`Tier not found for user ${user.id}`);

          const pageviews = await monthlyPageviews(supabase, user.id);
          const { traffic_limit } = matchedTier.features;
          if (pageviews < traffic_limit) {
            return { userId: user.id, action: "no_update_needed", names: [] };
          }

          const { data: updated, error: updateError } = await supabase
            .from("catalogues")
            .update({ status: "inactive" })
            .eq("user_id", user.id)
            .eq("status", "active")
            .select("name");

          if (updateError) throw updateError;
          const names = (updated ?? []).map((row) => row.name as string);
          return { userId: user.id, action: "catalogues_inactivated", names };
        }),
      );

      // 3. Switch off catalogues that no longer fit their owner's plan.
      const misfitNames = await deactivateMisfits(supabase);

      // 4. Revalidate the catalogues that were just inactivated so their
      //    public pages stop being served from cache.
      const inactivatedNames = [
        ...results.flatMap((r) => (r.status === "fulfilled" ? r.value.names : [])),
        ...misfitNames,
      ];
      for (let i = 0; i < inactivatedNames.length; i += REVALIDATE_BATCH_SIZE) {
        const names = inactivatedNames.slice(i, i + REVALIDATE_BATCH_SIZE);
        try {
          await revalidateData(env, { names, dashboard: true });
        } catch (err) {
          console.error("Revalidation after inactivation failed:", err);
        }
      }

      // 5. Collect and summarize results
      const summary = results.map((r) =>
        r.status === "fulfilled"
          ? {
              userId: r.value.userId,
              action: r.value.action,
              inactivated: r.value.names.length,
            }
          : { error: (r.reason as Error).message },
      );

      return console.log({
        success: true,
        result: summary,
        overPlanInactivated: misfitNames.length,
      });
    } catch (err) {
      console.error("Error in DailySubscriptionCheck:", err);
      return console.log(
        { success: false, result: (err as Error).message },
        500,
      );
    }
  }
}
