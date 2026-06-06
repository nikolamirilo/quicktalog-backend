import { Bool, OpenAPIRoute } from "chanfana";
import z from "zod";
import { type AppContext } from "../types";
import { supabaseAdmin } from "../lib/supabase";
import {
  deleteUploadthingFiles,
  extractUploadthingKeysFromValue,
  listUploadthingFiles,
  type UploadthingFile,
} from "../utils/uploadthing";
import { PROTECTED_UPLOADTHING_URLS } from "../constants";

const CATALOGUE_IMAGE_FIELDS =
  "logo, content, appearance, header, footer, partners, metadata";

const PROTECTED_KEYS: ReadonlySet<string> = new Set(
  PROTECTED_UPLOADTHING_URLS.flatMap((url) =>
    extractUploadthingKeysFromValue(url),
  ),
);

const DEAD_KEY_SAMPLE_SIZE = 20;

const fileSchema = z.object({
  key: z.string(),
  name: z.string().nullable(),
  size: z.number(),
  uploadedAt: z.number(),
});

export class CleanupImages extends OpenAPIRoute {
  schema = {
    tags: ["Utilities"],
    summary:
      "Audit UploadThing files vs catalogue references (and optionally delete the orphans)",
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
        description:
          "UploadThing-side counts (what's stored vs referenced) and catalogue-side counts (which DB references are valid vs broken), with the actionable list of orphaned files.",
        content: {
          "application/json": {
            schema: z.object({
              success: Bool(),
              deleted: z.boolean(),
              uploadthing: z.object({
                totalFiles: z.number(),
                usedFiles: z.number(),
                unusedFiles: z.number(),
                totalSizeBytes: z.number(),
                unusedSizeBytes: z.number(),
                duplicateGroups: z.array(
                  z.object({
                    name: z.string().nullable(),
                    size: z.number(),
                    count: z.number(),
                    keys: z.array(z.string()),
                  }),
                ),
              }),
              catalogues: z.object({
                distinctReferencedKeys: z.number(),
                validKeys: z.number(),
                deadKeys: z.number(),
                protectedKeys: z.number(),
                sampleDeadKeys: z.array(z.string()),
              }),
              unused: z.array(fileSchema),
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

    // 1. Collect every UploadThing key referenced by any catalogue, seeded
    //    with always-protected keys (e.g. the frontend's fallback image)
    //    that may never appear in any DB row.
    console.log("🔍 Scanning catalogues for referenced UploadThing keys...");
    const referencedKeys = new Set<string>(PROTECTED_KEYS);
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
          referencedKeys.add(key);
        }
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    console.log(
      `✅ Found ${referencedKeys.size} distinct UploadThing keys in catalogues (incl. ${PROTECTED_KEYS.size} protected)`,
    );

    // 2. List every file on UploadThing.
    console.log("📥 Listing all UploadThing files...");
    let allFiles: UploadthingFile[];
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

    // 3. Build the two internally-consistent reports.
    //
    //    UploadThing side: every file is either USED (referenced by ≥1 catalogue)
    //    or UNUSED. usedFiles + unusedFiles === totalFiles.
    //
    //    Catalogue side: every distinct referenced key is either VALID (resolves
    //    to a real UT file) or DEAD (doesn't). validKeys + deadKeys ===
    //    distinctReferencedKeys.
    //
    //    Cross-link: validKeys === usedFiles. They count the same intersection
    //    from each side.
    const allFileKeys = new Set(allFiles.map((f) => f.key));
    const usedFiles: UploadthingFile[] = [];
    const unusedFiles: UploadthingFile[] = [];
    for (const f of allFiles) {
      (referencedKeys.has(f.key) ? usedFiles : unusedFiles).push(f);
    }
    const deadKeys: string[] = [];
    for (const key of referencedKeys) {
      if (!allFileKeys.has(key)) deadKeys.push(key);
    }

    // Size totals — helps decide whether deletion is worth running.
    const totalSizeBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    const unusedSizeBytes = unusedFiles.reduce(
      (sum, f) => sum + (f.size || 0),
      0,
    );

    // Duplicate detection — files with the same name and size are almost
    // certainly the same image uploaded multiple times. Only emit groups
    // with more than one member.
    const byNameSize = new Map<string, UploadthingFile[]>();
    for (const f of allFiles) {
      const k = `${f.name ?? ""}|${f.size ?? 0}`;
      let group = byNameSize.get(k);
      if (!group) {
        group = [];
        byNameSize.set(k, group);
      }
      group.push(f);
    }
    const duplicateGroups = [...byNameSize.values()]
      .filter((g) => g.length > 1)
      .map((g) => ({
        name: g[0].name ?? null,
        size: g[0].size,
        count: g.length,
        keys: g.map((f) => f.key),
      }))
      .sort((a, b) => b.count - a.count);

    console.log(
      `📊 UT: ${usedFiles.length} used / ${unusedFiles.length} unused; ` +
        `DB: ${referencedKeys.size - deadKeys.length} valid / ${deadKeys.length} dead; ` +
        `${duplicateGroups.length} duplicate groups`,
    );

    // 4. Optionally delete the orphaned UT files.
    let deleted = false;
    if (shouldDelete && unusedFiles.length > 0) {
      console.log(`🗑️ Deleting ${unusedFiles.length} unused files...`);
      try {
        await deleteUploadthingFiles(
          c.env.UPLOADTHING_TOKEN,
          unusedFiles.map((f) => f.key),
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
      deleted,
      uploadthing: {
        totalFiles: allFiles.length,
        usedFiles: usedFiles.length,
        unusedFiles: unusedFiles.length,
        totalSizeBytes,
        unusedSizeBytes,
        duplicateGroups,
      },
      catalogues: {
        distinctReferencedKeys: referencedKeys.size,
        validKeys: referencedKeys.size - deadKeys.length,
        deadKeys: deadKeys.length,
        protectedKeys: PROTECTED_KEYS.size,
        sampleDeadKeys: deadKeys.slice(0, DEAD_KEY_SAMPLE_SIZE),
      },
      unused: unusedFiles.map((f) => ({
        key: f.key,
        name: f.name ?? null,
        size: f.size,
        uploadedAt: f.uploadedAt,
      })),
    });
  }
}
