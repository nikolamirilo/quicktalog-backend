import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { generatePromptForAI } from "../utils/ai";
import { generateUniqueSlug, CategoryBlock, defaultCatalogueData } from "@quicktalog/common";
import {
  createInitialCatalogue,
  revalidateData,
  safeExtractJSONFromResponse,
} from "../helpers";
import { generateOrderPrompt } from "../utils/ocr";
import { processImageGeneration } from "../helpers/imageGeneration";

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

    const database = supabaseAdmin(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const slug = generateUniqueSlug(formData.name) || formData.name;

    // Create initial catalogue entry
    const catalogueCreated = await createInitialCatalogue(
      database,
      slug,
      formData,
      "ai_prompt",
      userId,
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
        shouldGenerateImages,
      );
      console.log(
        "⏳ Sending generation request to DeepSeek (Timeout: 120s)...",
      );
      const aiResponse = await chatCompletion(
        generationPrompt,
        c.env.DEEPSEEK_API_KEY,
        120000,
      );
      console.log("✅ DeepSeek generation response received");

      console.log(aiResponse);
      const generatedData = safeExtractJSONFromResponse(aiResponse, "object");
      // Normalise: AI may return the array under 'services' or 'content'
      if (!generatedData.services && generatedData.content) {
        generatedData.services = generatedData.content;
      }
      if (!Array.isArray(generatedData.services)) {
        throw new Error("AI response did not contain a valid services/content array");
      }
      console.log(`📦 Generated ${generatedData.services.length} categories`);

      // Order categories with AI (with fallback to original order)
      console.log("🔄 Ordering categories...");
      let orderedItems = generatedData.services;
      let orderingFailed = false;

      const orderingPrompt = generateOrderPrompt(
        generatedData.services,
        formData,
      );
      console.log("⏳ Sending ordering request to DeepSeek (Timeout: 60s)...");
      const orderingResponse = await chatCompletion(
        orderingPrompt,
        c.env.DEEPSEEK_API_KEY,
        60000,
      );
      console.log("✅ Ordering response received");
      const extractedOrderingResponse = safeExtractJSONFromResponse<string[]>(
        orderingResponse,
        "array",
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
          `⚠️ Ordering invalid (expected: ${generatedData.services.length
          }, received: ${extractedOrderingResponse?.length || 0
          }), using original order`,
        );
        orderingFailed = true;
      }

      // Map generated basic format into ContentBlock list
      const mappedContentBlocks: CategoryBlock[] = orderedItems.map((category: any, index: number) => ({
        id: crypto.randomUUID(),
        type: "category",
        name: category.name,
        order: category.order !== undefined ? category.order : index,
        isExpanded: true,
        layout: "variant_3",
        items: Array.isArray(category.items) ? category.items.map((item: any, itemIndex: number) => ({
          id: crypto.randomUUID(),
          order: itemIndex,
          name: item.name,
          description: item.description || "",
          image: item.image || "",
          price: item.price || 0,
        })) : []
      }));

      // Save catalogue to database
      const catalogueData = {
        status: "active",
        content: mappedContentBlocks
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
            await processImageGeneration(c.env, mappedContentBlocks, slug);
          })(),
        );
        console.log("🎨 Image generation started in background");
      }

      // Record usage (uses service-role key to bypass RLS on the prompts table)
      console.log("💾 Recording usage...");
      const adminDb = supabaseAdmin(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY);
      const { error: usageError } = await adminDb
        .from("prompts")
        .insert({ user_id: userId, catalogue: slug });

      if (usageError) {
        console.error("⚠️ Failed to record usage:", usageError);
      }
      console.log("🎉 Catalogue generation completed successfully");
      await revalidateData(c.env.APP_URL);
      return c.json({ success: true, slug }, 200);
    } catch (error) {
      console.error("❌ Error generating catalogue:", error);

      await database
        .from("catalogues")
        .update({ content: [], status: "error" })
        .eq("name", slug);

      return c.json(
        {
          message: "Error occurred while generating catalogue using AI",
          error,
        },
        500,
      );
    }
  }
}
