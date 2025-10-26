import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { supabaseClient } from "../lib/supabase";
import { generatePromptForAI } from "../utils/ai";
import { CatalogueCategory, generateUniqueSlug } from "@quicktalog/common";
import {
  extractJSONArrayFromResponse,
  extractJSONFromResponse,
} from "../helpers";
import { generateOrderPrompt } from "../utils/ocr";

export class AIGeneration extends OpenAPIRoute {
  schema = {
    tags: ["Catalogue"],
    summary: "AI Catalogue Generation",
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
    const { prompt, formData, shouldGenerateImages, userId } = data.body;

    if (!prompt?.trim()) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    if (!formData?.name?.trim()) {
      return c.json({ error: "Service name is required" }, 400);
    }
    const generationPrompt = generatePromptForAI(
      prompt,
      formData,
      shouldGenerateImages
    );

    try {
      const database = supabaseClient(
        c.env.SUPABASE_URL,
        c.env.SUPABASE_ANON_KEY
      );
      const aiResponse = await chatCompletion(
        generationPrompt,
        c.env.DEEPSEEK_API_KEY
      );

      let generatedData: CatalogueCategory[];

      try {
        generatedData = extractJSONArrayFromResponse(aiResponse);
      } catch (parseError) {
        console.error("Failed to parse AI response:", aiResponse, parseError);
        return c.json({ error: "Invalid AI response format" }, 500);
      }

      console.log("\n🔄 === CATEGORY ORDERING ===");
      let orderedItems: CatalogueCategory[] = generatedData;
      const orderingPrompt = generateOrderPrompt(generatedData, formData);
      try {
        const orderingResponse = await chatCompletion(
          orderingPrompt,
          c.env.DEEPSEEK_API_KEY
        );
        console.log("📥 Category ordering response received");

        const parsedNames = extractJSONFromResponse<string[]>(
          orderingResponse,
          "array"
        );

        if (
          Array.isArray(parsedNames) &&
          parsedNames.length === generatedData.length
        ) {
          console.log("✅ Parsed valid array of category names:", parsedNames);

          orderedItems = parsedNames.map((newName, index) => ({
            ...orderedItems[index],
            name: newName,
            order: index,
          }));

          console.log("🎉 Category ordering successful!");
          orderedItems.forEach((service) => {
            console.log(
              `   ${service.order}. ${service.name} (${service.items.length} items)`
            );
          });
        } else {
          console.log("⚠️ Ordering array invalid or length mismatch:");
          console.log(
            "   Expected:",
            generatedData.length,
            "Received:",
            parsedNames?.length || 0
          );
          orderedItems = generatedData;
        }
      } catch (e) {
        console.error("💥 Failed to parse category ordering response:", e);
        orderedItems = generatedData;
      }

      const catalogueSlug = generateUniqueSlug(formData.name) || formData.name;

      const catalogueData = {
        name: catalogueSlug || formData.name,
        status: shouldGenerateImages === true ? "in preparation" : "active",
        title: formData.title,
        currency: formData.currency,
        theme: formData.theme,
        subtitle: formData.subtitle,
        created_by: userId,
        logo: "",
        legal: {},
        partners: [],
        configuration: {},
        contact: [],
        services: orderedItems,
        source: "ai_prompt",
      };

      console.log("Ordered items", orderedItems);

      const { error } = await database
        .from("catalogues")
        .insert([catalogueData])
        .select();
      if (error) {
        console.error(
          "❌ Error inserting data into Supabase catalogues table:",
          error
        );
        return c.json({ success: false, error }, 500);
      } else {
        console.log("✅ Catalogue created successfully!");
        if (shouldGenerateImages === true) {
          fetch(`${c.env.BASE_URL}/api/generate/images`, {
            method: "POST",
            body: JSON.stringify({
              data: orderedItems,
              name: catalogueSlug,
            }),
          });
          console.log("Sent request for image generation");
        } else {
          console.log("ShouldGenerateImages set to false, skipping this step");
        }
        console.log("💾 Inserting usage record...");
        const { error: errorOcrUsageEntry } = await database
          .from("prompts")
          .insert([{ user_id: userId, catalogue: catalogueSlug }]);

        if (errorOcrUsageEntry) {
          console.error(
            "❌ Error inserting data into Supabase ocr table:",
            errorOcrUsageEntry
          );
        }

        console.log("\n🎉 === PROCESS COMPLETED SUCCESSFULLY ===");
        console.log(
          "🔄 Categories properly ordered:",
          orderedItems.map((s) => `${s.order}. ${s.name}`).join(" → ")
        );

        return c.json({ success: true, slug: catalogueSlug }, 200);
      }
    } catch (error) {
      console.error("Error occured while generating catalogue using AI", error);
      return c.json(
        {
          message: "Error occured while generating catalogue using AI",
          error,
        },
        500
      );
    }
  }
}
