import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { supabaseClient } from "../lib/supabase";
import { generatePromptForAI } from "../utils/ai";
import { CatalogueCategory, generateUniqueSlug } from "@quicktalog/common";
import {
  createInitialCatalogue,
  revalidateData,
  safeExtractJSONFromResponse,
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

    // Validation
    if (!prompt?.trim()) {
      return c.json({ error: "Prompt is required" }, 400);
    }
    if (!formData?.name?.trim()) {
      return c.json({ error: "Service name is required" }, 400);
    }

    const database = supabaseClient(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY
    );
    const slug = generateUniqueSlug(formData.name) || formData.name;

    // Create initial catalogue entry
    const catalogueCreated = await createInitialCatalogue(
      database,
      slug,
      formData,
      "ai_prompt",
      userId
    );

    if (!catalogueCreated) {
      console.error("❌ Failed to create initial catalogue");
      return c.json({ error: "Failed to create initial catalogue" }, 500);
    }

    try {
      console.log("🤖 Generating catalogue with AI...");

      const generationPrompt = generatePromptForAI(
        prompt,
        formData,
        shouldGenerateImages
      );
      const aiResponse = await chatCompletion(
        generationPrompt,
        c.env.DEEPSEEK_API_KEY,
        "deepseek-reasoner"
      );

      console.log(aiResponse);
      const generatedData = safeExtractJSONFromResponse(aiResponse, "object");
      console.log(`📦 Generated ${generatedData.services.length} categories`);

      // Order categories with AI (with fallback to original order)
      console.log("🔄 Ordering categories...");
      let orderedItems = generatedData.services;
      let orderingFailed = false;

      const orderingPrompt = generateOrderPrompt(
        generatedData.services,
        formData
      );
      const orderingResponse = await chatCompletion(
        orderingPrompt,
        c.env.DEEPSEEK_API_KEY
      );
      const extractedOrderingResponse = safeExtractJSONFromResponse<string[]>(
        orderingResponse,
        "array"
      );

      if (
        Array.isArray(extractedOrderingResponse) &&
        extractedOrderingResponse.length === generatedData.length
      ) {
        orderedItems = extractedOrderingResponse.map((newName, index) => ({
          ...generatedData.services[index],
          name: newName,
          order: index,
        }));

        orderedItems.forEach(({ order, name, items }) => {
          console.log(`   ${order}. ${name} (${items.length} items)`);
        });
      } else {
        console.log(
          `⚠️ Ordering invalid (expected: ${
            generatedData.services.length
          }, received: ${
            extractedOrderingResponse?.length || 0
          }), using original order`
        );
        orderingFailed = true;
      }

      // Save catalogue to database
      const catalogueData = {
        name: slug,
        status: "active",
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

      const { error: saveError } = await database
        .from("catalogues")
        .update(catalogueData)
        .eq("name", slug);

      if (saveError) {
        console.error("❌ Failed to save catalogue:", saveError);
        throw saveError;
      }

      console.log("✅ Catalogue saved successfully");

      // Start image generation in background if requested
      if (shouldGenerateImages) {
        c.executionCtx.waitUntil(
          (async () => {
            const generateImagesHandler = new GenerateImages();
            await generateImagesHandler.handle(c, orderedItems, slug);
          })()
        );
        console.log("🎨 Image generation started in background");
      }

      // Record usage
      console.log("💾 Recording usage...");
      const { error: usageError } = await database
        .from("prompts")
        .insert({ user_id: userId, catalogue: slug });

      if (usageError) {
        console.error("⚠️ Failed to record usage:", usageError);
      }

      console.log("🎉 Catalogue generation completed successfully");
      return c.json({ success: true, slug }, 200);
    } catch (error) {
      console.error("❌ Error generating catalogue:", error);

      await database
        .from("catalogues")
        .update({ services: [], status: "error" })
        .eq("name", slug);

      return c.json(
        {
          message: "Error occurred while generating catalogue using AI",
          error,
        },
        500
      );
    } finally {
      await revalidateData(c.env.APP_URL);
    }
  }
}
