import { Bool, OpenAPIRoute } from "chanfana";
import { type AppContext } from "../types";
import z from "zod";
import { generateImage } from "../utils";
import { error } from "console";

export class GenerateImages extends OpenAPIRoute {
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
        description: "Returns generated Images",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              result: z.string(),
            }),
          },
        },
      },
      500: {
        description: "Returns error log",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              error: z.string(),
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
        if (category.layout !== "variant_3" && shouldGenerateImages) {
          await Promise.all(
            category.items.map(async (item) => {
              item.image = await generateImage(item.name, c.env);
            })
          );
        }
      }
      const updatedItems = structuredClone(items);
      return c.json(
        {
          success: true,
          result: updatedItems,
        },
        200
      );
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
