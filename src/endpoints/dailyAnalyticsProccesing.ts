import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import z from "zod";

export class DailyAnalyticsProccessing extends OpenAPIRoute {
  schema = {
    tags: ["Analytics"],
    summary: "Daily Analytics Proccessing Job",
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
    // const { prompt } = data.body;
    // const response = await chatCompletion(prompt, c.env.DEEPSEEK_API_KEY);

    return c.json({
      success: true,
      result: "response",
    });
  }
}
