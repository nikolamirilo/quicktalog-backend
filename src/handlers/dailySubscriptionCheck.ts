import { Bool, OpenAPIRoute } from "chanfana";
import z from "zod";
import { AppContext } from "../types";

export class DailySubscriptionCheck extends OpenAPIRoute {
  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const res = await fetch(`${c.env.BASE_URL}/api/analytics`);
      console.log(res);
      console.log(`${c.env.BASE_URL}/api/analytics`);
      const formated = await res.json();
      return c.json({
        success: true,
        result: formated,
      });
    } catch (err) {
      console.error("Error:", err);
      return c.json({ success: false, result: (err as Error).message }, 500);
    }
  }
}
