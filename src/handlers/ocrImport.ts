import { Bool, OpenAPIRoute } from "chanfana";
import {
  BasicResponse,
  OCRImportRequestSchema,
  type AppContext,
} from "../types";
import z from "zod";
import { chatCompletion } from "../lib/deepseek";
import { supabaseClient } from "../lib/supabase";
import {
  generateOrderPrompt,
  generatePromptForCategoryDetection,
  generatePromptForCategoryProcessing,
} from "../utils/ocr";
import { CatalogueCategory, generateUniqueSlug } from "@quicktalog/common";
import {
  createInitialCatalogue,
  extractJSONFromResponse,
  revalidateData,
  safeExtractJSONFromResponse,
} from "../helpers";

export class OCRImport extends OpenAPIRoute {
  schema = {
    tags: ["Catalogue"],
    summary: "OCR Catalogue Import",
    request: {
      body: {
        content: {
          "application/json": {
            schema: OCRImportRequestSchema,
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
    const { input_text, formData, shouldGenerateImages, userId } = data.body;

    if (!input_text) {
      console.log("❌ ERROR: OCR text is missing");
      return c.json({ error: "input_text is required" }, 400);
    }

    console.log("🚀 === OCR PROCESSING STARTED ===");
    const start = performance.now();
    const database = supabaseClient(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY
    );
    const slug = generateUniqueSlug(formData.name);
    const catalogueCreationRes = await createInitialCatalogue(
      database,
      slug,
      formData,
      "ocr_import",
      userId
    );

    if (catalogueCreationRes !== true) {
      console.error("Error occured while inserting initial catalogue");
      return;
    }

    try {
      // STEP 1: CATEGORY DETECTION
      console.log("\n🔍 === STEP 1: CATEGORY DETECTION ===");
      console.log(input_text);
      const categoryDetectionPrompt = generatePromptForCategoryDetection(
        input_text,
        formData.language
      );
      console.log("⏳ Sending request to DeepSeek (Timeout: 120s)...");
      const categoryDetectionResponse = await chatCompletion(
        categoryDetectionPrompt,
        c.env.DEEPSEEK_API_KEY,
        120000
      );
      console.log("✅ DeepSeek response received");

      console.log("🔧 Parsing category detection response...");
      const categoryData = safeExtractJSONFromResponse<{ chunks: string[] }>(
        categoryDetectionResponse,
        "object"
      );

      console.log(
        "✅ Parsed category data:",
        JSON.stringify(categoryData, null, 2)
      );

      if (!Array.isArray(categoryData.chunks)) {
        console.log(
          "❌ ERROR: chunks is not an array:",
          typeof categoryData.chunks,
          categoryData.chunks
        );
        throw new Error(
          "Invalid chunks structure in category detection response"
        );
      }

      const categoryChunks = categoryData.chunks;
      console.log(
        "🎉 Successfully extracted",
        categoryChunks.length,
        "category chunks"
      );

      // STEP 2: PARALLEL CATEGORY PROCESSING
      console.log("\n⚡ === STEP 2: PARALLEL CATEGORY PROCESSING ===");
      console.log(
        "🔄 Processing",
        categoryChunks.length,
        "categories in parallel..."
      );

      const categoryProcessingPromises = categoryChunks.map((chunk, index) => {
        const categoryPrompt = generatePromptForCategoryProcessing(
          chunk,
          formData,
          index + 1,
          shouldGenerateImages
        );
        return chatCompletion(
          categoryPrompt,
          c.env.DEEPSEEK_API_KEY,
          60000
        );
      });

      const categoryResponses = await Promise.all(categoryProcessingPromises);
      console.log(
        "📥 All category responses received! Count:",
        categoryResponses.length
      );

      // STEP 3: RESPONSE PROCESSING & VALIDATION
      console.log("\n🔧 === STEP 3: RESPONSE PROCESSING & VALIDATION ===");
      const items: CatalogueCategory[] = [];

      for (let i = 0; i < categoryResponses.length; i++) {
        const response = categoryResponses[i];
        const categoryData = extractJSONFromResponse<CatalogueCategory>(
          response,
          "object"
        );

        console.log(
          `✅ Category ${i + 1} parsed data:`,
          JSON.stringify(categoryData, null, 2)
        );

        if (
          categoryData &&
          categoryData.name &&
          Array.isArray(categoryData.items)
        ) {
          items.push(categoryData);
          console.log(`🎉 Category ${i + 1} added to items array!`);
        } else {
          console.error(`❌ Invalid category structure for category ${i + 1}:`);
          console.error(`   📛 Has name: ${!!categoryData.name}`);
        }
      }

      console.log("\n📊 === INITIAL ITEMS SUMMARY ===");
      console.log("🎯 Total valid items created:", items.length);

      if (items.length === 0) {
        console.log("❌ ERROR: No valid items were generated");
        throw new Error("No valid items were generated");
      }

      let updatedItems = items;

      // STEP 4: CATEGORY ORDERING
      console.log("\n🔄 === STEP 4: CATEGORY ORDERING ===");
      let orderedItems: CatalogueCategory[] = updatedItems;
      const orderingPrompt = generateOrderPrompt(updatedItems, formData);

      console.log("⏳ Sending ordering request to DeepSeek (Timeout: 60s)...");
      const orderingResponse = await chatCompletion(
        orderingPrompt,
        c.env.DEEPSEEK_API_KEY,
        60000
      );
      console.log("✅ Ordering response received");
      console.log("📥 Category ordering response received");

      const parsedNames = extractJSONFromResponse<string[]>(
        orderingResponse,
        "array"
      );

      if (
        Array.isArray(parsedNames) &&
        parsedNames.length === updatedItems.length
      ) {
        console.log("✅ Parsed valid array of category names:", parsedNames);

        const nameToItem = new Map(
          updatedItems.map((item) => [item.name, item])
        );

        orderedItems = parsedNames
          .map((name, index) => {
            const original = nameToItem.get(name);
            return original ? { ...original, order: index } : null;
          })
          .filter(Boolean);

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
          updatedItems.length,
          "Received:",
          parsedNames?.length || 0
        );
        orderedItems = updatedItems;
      }

      console.log("\n === STEP 5: DATABASE OPERATIONS ===");

      const catalogueData = {
        name: slug || formData.name,
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
        source: "ocr_import",
      };

      const { error } = await database
        .from("catalogues")
        .update([catalogueData])
        .eq("name", slug);

      if (error) {
        console.error(
          "❌ Error inserting data into Supabase catalogues table:",
          error
        );
        throw error;
      }

      console.log("✅ Catalogue created successfully!");

      // if (shouldGenerateImages === true) {
      //   c.executionCtx.waitUntil(
      //     (async () => {
      //       try {

      //       } catch (err) {
      //         console.error(
      //           "[waitUntil] Background GenerateImages failed:",
      //           err
      //         );
      //       }
      //     })()
      //   );
      //   console.log("Started with images search and update of items");
      // } else {
      //   console.log("ShouldGenerateImages set to false, skipping this step");
      // }

      console.log("💾 Inserting usage record...");
      const { error: errorOcrUsageEntry } = await database
        .from("ocr")
        .insert([{ user_id: userId, catalogue: slug }]);

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

      return c.json({ success: true, slug: slug }, 200);
    } catch (error) {
      console.error("\nCRITICAL ERROR OCCURRED DURING OCR IMPORT");
      console.error(error);
      await database
        .from("catalogues")
        .update({ services: [], status: "error" })
        .eq("name", slug);
      return c.json(
        {
          success: false,
          message: `Error occured while doing OCR import of catalogue ${formData.name}`,
          error,
        },
        500
      );
    } finally {
      await revalidateData(c.env.APP_URL);
      const end = performance.now();
      const durationMs = end - start;
      const durationSec = durationMs / 1000;
      const minutes = Math.floor(durationSec / 60);
      const seconds = (durationSec % 60).toFixed(2);
      console.log(
        `OCR Import for ${formData.name} took ${minutes} min ${seconds} sec`
      );
    }
  }
}
