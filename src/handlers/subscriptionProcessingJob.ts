import { OpenAPIRoute } from "chanfana";
import { Env } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import {
  catalogueFitsPlan,
  misfitMessage,
  tiers,
  usagePeriod,
  usagePeriodDays,
} from "@quicktalog/common";
import { revalidateData } from "../helpers";

const PAGE_SIZE = 1000;
// Catalogue rows carry their whole content, so they are read in smaller pages.
const CATALOGUE_PAGE_SIZE = 200;
// Matches the max batch accepted by the app's /api/revalidate route.
const REVALIDATE_BATCH_SIZE = 500;

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

type Tier = (typeof tiers)[number];

type JobUser = { id: string; plan_id: string | null; created_at: string };

type OffCatalogue = {
  id: string;
  name: string;
  content: unknown;
  traffic_off_at: string;
};

const tierFor = (planId: string | null): Tier =>
  tiers.find((tier) => Object.values(tier.priceId).includes(planId ?? "")) ??
  tiers[0];

/** Every account, paged. The traffic check covers the free plan too, so this is all of them. */
async function allUsers(supabase: SupabaseAdmin): Promise<JobUser[]> {
  const users: JobUser[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("users")
      .select("id, plan_id, created_at")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    users.push(...((data ?? []) as JobUser[]));
    if (!data || data.length < PAGE_SIZE) return users;
  }
}

/**
 * Page views inside each account's own 30-day period, anchored on `created_at` the way
 * private.usage_period_start() anchors it for the app. Summed in one pass over the days any
 * live period can still cover: a query per account would spend the Worker's subrequest
 * budget now that every account is checked.
 */
async function pageviewsByUser(
  supabase: SupabaseAdmin,
  users: JobUser[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (users.length === 0) return totals;

  const windows = new Map(
    users.map((user) => [user.id, usagePeriodDays(user.created_at)]),
  );
  let earliest = "9999-12-31";
  for (const window of windows.values()) {
    if (window.start < earliest) earliest = window.start;
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("analytics")
      .select("user_id, day, pageviews")
      .gte("day", earliest)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      // Rows of a deleted catalogue keep user_id, so they still count against the plan.
      const window = windows.get(row.user_id);
      if (!window || row.day < window.start || row.day >= window.end) continue;
      totals.set(
        row.user_id,
        (totals.get(row.user_id) ?? 0) + (row.pageviews ?? 0),
      );
    }
    if (!data || data.length < PAGE_SIZE) return totals;
  }
}

/** The catalogues this job switched off for traffic and whose status nobody has touched since. */
async function trafficOffByUser(
  supabase: SupabaseAdmin,
): Promise<Map<string, OffCatalogue[]>> {
  const byUser = new Map<string, OffCatalogue[]>();
  for (let from = 0; ; from += CATALOGUE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("catalogues")
      .select("id, user_id, name, content, traffic_off_at")
      .eq("status", "inactive")
      .not("traffic_off_at", "is", null)
      .order("id")
      .range(from, from + CATALOGUE_PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row as OffCatalogue);
      byUser.set(row.user_id, list);
    }
    if (!data || data.length < CATALOGUE_PAGE_SIZE) return byUser;
  }
}

/** Takes an account's catalogues offline, stamped so the next period can bring them back. */
async function switchOffForTraffic(
  supabase: SupabaseAdmin,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("catalogues")
    .update({ status: "inactive", traffic_off_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "active")
    .select("name");
  if (error) throw error;
  return (data ?? []).map((row) => row.name as string);
}

/**
 * One attempt to bring back what this job switched off in an earlier period, now that the
 * allowance has reset: re-activated if it still fits the plan, and the flag is cleared
 * either way, so nothing is retried run after run or comes back weeks later unexplained.
 */
async function switchBackOn(
  supabase: SupabaseAdmin,
  user: JobUser,
  offs: OffCatalogue[],
  tier: Tier,
): Promise<{ names: string[]; stuck: string[] }> {
  const periodStart = usagePeriod(user.created_at).start;
  const fits: OffCatalogue[] = [];
  const stuck: OffCatalogue[] = [];
  for (const row of offs) {
    if (new Date(row.traffic_off_at) >= periodStart) continue;
    const fit = catalogueFitsPlan(row.content, tier.features);
    ("misfit" in fit ? stuck : fits).push(row);
  }

  const names: string[] = [];
  if (fits.length > 0) {
    const { data, error } = await supabase
      .from("catalogues")
      .update({ status: "active", traffic_off_at: null })
      .in(
        "id",
        fits.map((row) => row.id),
      )
      .eq("status", "inactive")
      .select("name");
    if (error) throw error;
    names.push(...(data ?? []).map((row) => row.name as string));
  }
  if (stuck.length > 0) {
    const { error } = await supabase
      .from("catalogues")
      .update({ traffic_off_at: null })
      .in(
        "id",
        stuck.map((row) => row.id),
      );
    if (error) throw error;
  }
  return { names, stuck: stuck.map((row) => row.name) };
}

/**
 * Switches off every active catalogue that no longer fits its owner's plan
 * (too many items or sections, or a block type the plan lacks) - what a
 * downgrade leaves behind. Covers every user, free plan included, since a
 * downgrade lands there. The app refuses switching it back on until it fits.
 * Not stamped: a catalogue over its plan needs the owner to change something,
 * so it must not come back on its own.
 */
async function deactivateMisfits(supabase: SupabaseAdmin, users: JobUser[]) {
  const plans = new Map(users.map((user) => [user.id, user.plan_id]));

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

      // 1. Every account, their usage for their own period, and what this job has
      //    already switched off for traffic.
      const users = await allUsers(supabase);
      const [pageviews, trafficOff] = await Promise.all([
        pageviewsByUser(supabase, users),
        trafficOffByUser(supabase),
      ]);

      // 2. Over the allowance: offline. Under it, with something this job switched off in
      //    an earlier period: back online.
      const inactivated: string[] = [];
      const reactivated: string[] = [];
      const summary: Record<string, unknown>[] = [];

      for (const user of users) {
        const tier = tiers.find((candidate) =>
          Object.values(candidate.priceId).includes(user.plan_id ?? ""),
        );
        if (!tier) {
          // Never judged against another plan's limits: that could take a paying
          // customer's catalogues offline.
          summary.push({ userId: user.id, action: "unknown_plan", planId: user.plan_id });
          continue;
        }

        const views = pageviews.get(user.id) ?? 0;
        const over = views >= tier.features.traffic_limit;
        const offs = trafficOff.get(user.id) ?? [];
        if (!over && offs.length === 0) continue;

        try {
          if (over) {
            const names = await switchOffForTraffic(supabase, user.id);
            inactivated.push(...names);
            summary.push({
              userId: user.id,
              action: names.length > 0 ? "catalogues_inactivated" : "over_limit_already_off",
              inactivated: names.length,
              views,
              limit: tier.features.traffic_limit,
            });
            continue;
          }

          const { names, stuck } = await switchBackOn(supabase, user, offs, tier);
          reactivated.push(...names);
          if (names.length > 0 || stuck.length > 0) {
            summary.push({
              userId: user.id,
              action: "catalogues_back_online",
              reactivated: names.length,
              stillOverPlan: stuck.length,
            });
          }
        } catch (err) {
          summary.push({ userId: user.id, error: (err as Error).message });
        }
      }

      // 3. Switch off catalogues that no longer fit their owner's plan.
      const misfitNames = await deactivateMisfits(supabase, users);

      // 4. Revalidate every catalogue whose status changed, so the public pages stop - or
      //    start - being served from cache.
      const changedNames = [...inactivated, ...reactivated, ...misfitNames];
      for (let i = 0; i < changedNames.length; i += REVALIDATE_BATCH_SIZE) {
        const names = changedNames.slice(i, i + REVALIDATE_BATCH_SIZE);
        try {
          await revalidateData(env, { names, dashboard: true });
        } catch (err) {
          console.error("Revalidation after status changes failed:", err);
        }
      }

      return console.log({
        success: true,
        checked: users.length,
        inactivated: inactivated.length,
        reactivated: reactivated.length,
        overPlanInactivated: misfitNames.length,
        result: summary,
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
