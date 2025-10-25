import { Bool, OpenAPIRoute } from "chanfana";
import { AIGenerationRequestSchema, type AppContext } from "../types";
import { chatCompletion } from "../lib/deepseek";
import z from "zod";
import { supabaseClient } from "../lib/supabase";
import { generatePromptForAI } from "../utils/ai";
import { CatalogueCategory, generateUniqueSlug } from "@quicktalog/common";
import { generateImage, insertCatalogueData } from "../utils";
import { extractJSONArrayFromResponse } from "../helpers";

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

      for (const category of generatedData) {
        if (category.layout != "variant_3" && shouldGenerateImages == true) {
          for (const item of category.items) {
            item.image = await generateImage(item.name, c.env);
          }
        }
      }

      const catalogueSlug = generateUniqueSlug(formData.name) || formData.name;
      await insertCatalogueData(
        database,
        formData,
        generatedData,
        userId,
        catalogueSlug,
        "ai_prompt"
      );

      return c.json(
        {
          success: true,
          slug: catalogueSlug,
        },
        200
      );
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
