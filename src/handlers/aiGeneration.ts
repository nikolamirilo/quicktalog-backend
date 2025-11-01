import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { supabaseClient } from "../lib/supabase";
import { generatePromptForAI } from "../utils/ai";
import { CatalogueCategory, generateUniqueSlug } from "@quicktalog/common";
import {
  createInitialCatalogue,
  extractJSONArrayFromResponse,
  extractJSONFromResponse,
  revalidateData,
} from "../helpers";
import { generateOrderPrompt } from "../utils/ocr";
import { GenerateImages } from "./generateImages";

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
    const database = supabaseClient(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY
    );
    const slug = generateUniqueSlug(formData.name) || formData.name;
    const catalogueCreationRes = await createInitialCatalogue(
      database,
      slug,
      formData,
      "ai_prompt",
      userId
    );
    if (catalogueCreationRes == true) {
      try {
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
            console.log(
              "✅ Parsed valid array of category names:",
              parsedNames
            );

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

        const catalogueData = {
          name: slug || formData.name,
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
          .update([catalogueData])
          .eq("name", slug);
        if (error) {
          console.error(
            "❌ Error inserting data into Supabase catalogues table:",
            error
          );
          return c.json({ success: false, error }, 500);
        } else {
          console.log("✅ Catalogue created successfully!");
          if (shouldGenerateImages === true) {
            c.executionCtx.waitUntil(
              (async () => {
                const generateImagesHandler = new GenerateImages();
                await generateImagesHandler.handle(c, orderedItems, slug);
              })()
            );
            console.log("Started with images search and update of items");
          } else {
            console.log(
              "ShouldGenerateImages set to false, skipping this step"
            );
          }
          console.log("💾 Inserting usage record...");
          const { error: errorOcrUsageEntry } = await database
            .from("prompts")
            .insert([{ user_id: userId, catalogue: slug }]);

          if (errorOcrUsageEntry) {
            console.error(
              "❌ Error inserting data into Supabase ocr table:",
              errorOcrUsageEntry
            );
          }
          console.log("\n🎉 === PROCESS COMPLETED SUCCESSFULLY ===");
          return c.json({ success: true, slug: slug }, 200);
        }
      } catch (error) {
        console.error(
          "Error occured while generating catalogue using AI",
          error
        );
        await database
          .from("catalogues")
          .update({ services: [], status: "error" })
          .eq("name", slug);
        return c.json(
          {
            message: "Error occured while generating catalogue using AI",
            error,
          },
          500
        );
      } finally {
        await revalidateData(c.env.APP_URL);
      }
    } else {
      console.error("Error occured while inserting initial catalogue");
    }
  }
}
