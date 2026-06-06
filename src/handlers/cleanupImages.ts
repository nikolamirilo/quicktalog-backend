import { Bool, OpenAPIRoute } from "chanfana";
import z from "zod";
import { type AppContext } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import {
  deleteUploadthingFiles,
  extractUploadthingKeysFromValue,
  listUploadthingFiles,
} from "../utils/uploadthing";

const CATALOGUE_IMAGE_FIELDS =
  "logo, content, appearance, header, footer, partners, metadata";

export class CleanupImages extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary:
      "Find (and optionally delete) UploadThing files not referenced by any catalogue",
    request: {
      query: z.object({
        delete: z
          .enum(["true", "false"])
          .optional()
          .default("false")
          .transform((v) => v === "true"),
      }),
    },
    responses: {
      200: {
        description: "Returns the list of unused UploadThing files",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              totalUploaded: z.number(),
              usedCount: z.number(),
              unusedCount: z.number(),
              deleted: z.boolean(),
              unused: z.array(
                z.object({
                  key: z.string(),
                  name: z.string().nullable(),
                  size: z.number(),
                  uploadedAt: z.number(),
                }),
              ),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const shouldDelete = data.query.delete;

    if (!c.env.UPLOADTHING_TOKEN) {
      return c.json({ error: "UPLOADTHING_TOKEN not configured" }, 500);
    }

    const database = supabaseAdmin(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    // 1. Collect every UploadThing key referenced by any catalogue.
    console.log("🔍 Scanning catalogues for referenced UploadThing keys...");
    const usedKeys = new Set<string>();
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: rows, error } = await database
        .from("catalogues")
        .select(CATALOGUE_IMAGE_FIELDS)
        .range(from, from + pageSize - 1);
      if (error) {
        console.error("❌ Failed to read catalogues:", error);
        return c.json(
          { error: "Failed to read catalogues", details: error.message },
          500,
        );
      }
      if (!rows || rows.length === 0) break;
      for (const row of rows) {
        for (const key of extractUploadthingKeysFromValue(row)) {
          usedKeys.add(key);
        }
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    console.log(`✅ Found ${usedKeys.size} referenced UploadThing keys`);

    // 2. List every file in UploadThing.
    console.log("📥 Listing all UploadThing files...");
    let allFiles;
    try {
      allFiles = await listUploadthingFiles(c.env.UPLOADTHING_TOKEN);
    } catch (err) {
      console.error("❌ Failed to list UploadThing files:", err);
      return c.json(
        {
          error: "Failed to list UploadThing files",
          details: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
    console.log(`✅ Retrieved ${allFiles.length} UploadThing files`);

    // 3. Diff: files on UploadThing not referenced by any catalogue.
    const unused = allFiles.filter((f) => !usedKeys.has(f.key));
    console.log(`🧹 Unused files flagged for deletion: ${unused.length}`);

    // 4. Optionally delete.
    let deleted = false;
    if (shouldDelete && unused.length > 0) {
      console.log(`🗑️ Deleting ${unused.length} unused files...`);
      try {
        await deleteUploadthingFiles(
          c.env.UPLOADTHING_TOKEN,
          unused.map((f) => f.key),
        );
        deleted = true;
        console.log("✅ Deletion complete");
      } catch (err) {
        console.error("❌ Failed to delete UploadThing files:", err);
        return c.json(
          {
            error: "Failed to delete UploadThing files",
            details: err instanceof Error ? err.message : String(err),
          },
          500,
        );
      }
    }

    return c.json({
      success: true,
      totalUploaded: allFiles.length,
      usedCount: usedKeys.size,
      unusedCount: unused.length,
      deleted,
      unused: unused.map((f) => ({
        key: f.key,
        name: f.name ?? null,
        size: f.size,
        uploadedAt: f.uploadedAt,
      })),
    });
  }
}
