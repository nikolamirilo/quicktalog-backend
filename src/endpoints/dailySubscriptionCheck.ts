import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { generateImage } from "../utils";

export class DailySubscriptionCheck extends OpenAPIRoute {
  schema = {
    tags: ["Subscriptions"],
    summary: "Daily Subscription Check Job",
    request: {
      body: {
        content: {
          "application/json": {
            schema: AIGenerationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Returns AI response",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              result: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { prompt } = data.body;
    // const response = await chatCompletion(prompt, c.env.DEEPSEEK_API_KEY);
    const res = await generateImage(prompt, c.env);
    return c.json({
      success: true,
      result: res,
    });
  }
}
