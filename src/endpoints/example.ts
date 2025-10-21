import { Bool, Num, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { type AppContext } from "../types";

export class AIGeneration extends OpenAPIRoute {
  schema = {
    tags: ["Catalogue"],
    summary: "AI Catalogue Generation",
    request: {
      query: z.object({
        page: Num({
          description: "Page number",
          default: 0,
        }),
        isCompleted: Bool({
          description: "Filter by completed flag",
          required: false,
        }),
      }),
    },
    responses: {
      "200": {
        description: "Returns a list of tasks",
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
    const { page, isCompleted } = data.query;

    return {
      success: true,
      result: "Finished successfully",
    };
  }
}
