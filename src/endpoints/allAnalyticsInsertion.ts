import { Bool, OpenAPIRoute } from "chanfana";
import { GenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";

export class AllAnalyticsProccessing extends OpenAPIRoute {
  schema = {
    tags: ["Analytics"],
    summary: "All Analytics Proccessing Job",
    request: {
      body: {
        content: {
          "application/json": {
            schema: GenerationRequestSchema,
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
    const response = await chatCompletion(prompt, c.env.DEEPSEEK_API_KEY);

    return c.json({
      success: true,
      result: response,
    });
  }
}
