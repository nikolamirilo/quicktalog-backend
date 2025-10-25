import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { baseCategorySchema, generateImage } from "../utils";

export class GeneratePdf extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary: "Pdf Generation",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(
                z.object({
                  name: z.string(),
                  order: z.number(),
                  layout: z.string(),
                  items: z.array(
                    z.object({
                      name: z.string(),
                      description: z.string(),
                      image: z.string(),
                      price: z.number(),
                    })
                  ),
                })
              ),
              shouldGenerateImages: z.boolean(),
            }),
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
    const { items, shouldGenerateImages } = data.body;
    try {
      for (const category of items) {
        if (category.layout != "variant_3" && shouldGenerateImages == true) {
          for (const item of category.items) {
            item.image = await generateImage(item.name, c.env);
          }
        }
      }
      return c.json({
        success: true,
        result: items,
      });
    } catch (error) {
      console.error("Error occured", error);
      return c.json(
        {
          success: false,
          error: error,
        },
        500
      );
    }
  }
}
