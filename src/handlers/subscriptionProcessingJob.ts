import { OpenAPIRoute } from "chanfana";
import { Env } from "../types";
import { supabaseClient } from "../lib/supabase";
import { tiers, UserData } from "@quicktalog/common";

export class SubscriptionProcessingJob extends OpenAPIRoute {
  schema = {
    tags: ["Subscription"],
    summary: "Daily subscription usage check",
  };

  async handle(env: Env) {
    try {
      const supabase = supabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

      // 1. Get all users that are not on the free tier
      const { data: users, error: userError } = await supabase
        .from("users")
        .select("id, plan_id")
        .neq("plan_id", tiers[0].priceId.month);

      if (userError) throw userError;
      if (!users?.length)
        return console.log({ success: true, result: "No users to check" });

      // 2. Process users in parallel to improve performance
      const results = await Promise.allSettled(
        users.map(async (user) => {
          const res = await fetch(`${env.APP_URL}/api/users/${user.id}`);
          if (!res.ok) throw new Error(`Failed to fetch user ${user.id}`);
          const data: UserData = await res.json();

          const matchedTier = tiers.find((tier) =>
            Object.values(tier.priceId).includes(data.plan_id)
          );
          if (!matchedTier)
            throw new Error(`Tier not found for user ${user.id}`);

          const { pageview_count } = data.usage.traffic;
          const { traffic_limit } = matchedTier.features;
          console.log(pageview_count, traffic_limit);
          if (pageview_count >= traffic_limit) {
            const { error: updateError } = await supabase
              .from("catalogues")
              .update({ status: "inactive" })
              .eq("created_by", data.id);

            if (updateError) throw updateError;
            return { userId: user.id, action: "catalogues_inactivated" };
          } else {
            return { userId: user.id, action: "no_update_needed" };
          }
        })
      );

      // 3. Collect and summarize results
      const summary = results.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : { error: (r.reason as Error).message }
      );

      return console.log({ success: true, result: summary });
    } catch (err) {
      console.error("Error in DailySubscriptionCheck:", err);
      return console.log(
        { success: false, result: (err as Error).message },
        500
      );
    }
  }
}
