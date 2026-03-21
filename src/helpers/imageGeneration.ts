import { CategoryBlock } from "@quicktalog/common";
import { Env } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import { generateImage } from "../utils/general";

export async function processImageGeneration(
  env: Env,
  data: CategoryBlock[],
  name: string,
) {
  const database = supabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const processedData = await Promise.all(
      data.map(async (category) => {
        if (category.layout !== "variant_3") {
          return await generateImage(category, env);
        }
        return category;
      }),
    );

    const { error } = await database
      .from("catalogues")
      .update({ content: processedData, status: "active" })
      .eq("name", name);

    if (error) {
      console.error("Issue occurred while updating catalogue:", error);
      await database
        .from("catalogues")
        .update({ content: [], status: "error" })
        .eq("name", name);

      return {
        success: false,
        error: error.message || "Database update failed",
      };
    }

    return { success: true, result: "Updated record in database" };
  } catch (err) {
    console.error("Error occurred:", err);
    await database
      .from("catalogues")
      .update({ content: [], status: "error" })
      .eq("name", name);

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
