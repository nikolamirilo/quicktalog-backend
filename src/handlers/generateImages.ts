import { Bool, OpenAPIRoute } from "chanfana";
import { type AppContext } from "../types";
import z from "zod";
import { generateImage } from "../utils";
import { supabaseClient } from "../lib/supabase";
import { CatalogueCategory } from "@quicktalog/common";

export class GenerateImages extends OpenAPIRoute {
  async handle(c: AppContext, data: CatalogueCategory[], name: string) {
    const database = supabaseClient(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY
    );

    try {
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
        await database
          .from("catalogues")
          .update({ services: [], status: "error" })
          .eq("name", name);
        return console.log(
          { success: false, error: error.message || "Database update failed" },
          500
        );
      }

      return console.log(
        { success: true, result: "Updated record in database" },
        200
      );
    } catch (err) {
      console.error("Error occurred:", err);
      await database
        .from("catalogues")
        .update({ services: [], status: "error" })
        .eq("name", name);
      return console.log(
        {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        },
        500
      );
    }
  }
}
