import { Bool, OpenAPIRoute } from "chanfana";
import { type AppContext } from "../types";
import z from "zod";
import { generateImage } from "../utils";
import { supabaseClient } from "../lib/supabase";
import { CatalogueCategory } from "@quicktalog/common";

export class GenerateImages extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary: "Generate Images and Update Catalogue",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              data: z.any(),
              name: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successfully updated catalogue with generated images",
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
        description: "Error while generating images or updating database",
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
    const { body } = await this.getValidatedData<typeof this.schema>();
    const { data, name } = body;

    const database = supabaseClient(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY
    );

    try {
      // Process categories and generate images
      const processedData = await Promise.all(
        data.map(async (category) => {
          if (category.layout !== "variant_3") {
            return await generateImage(category, c.env);
          }
          return category;
        })
      );

      const { error } = await database
        .from("catalogues")
        .update({ services: processedData, status: "active" })
        .eq("name", name);

      if (error) {
        console.error("Issue occurred while updating catalogue:", error);
        return c.json(
          { success: false, error: error.message || "Database update failed" },
          500
        );
      }

      return c.json(
        { success: true, result: "Updated record in database" },
        200
      );
    } catch (err) {
      console.error("Error occurred:", err);
      return c.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        },
        500
      );
    }
  }
}
