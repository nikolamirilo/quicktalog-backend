import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AIGeneration } from "./handlers/aiGeneration";
import { OCRImport } from "./handlers/ocrImport";
import { DailySubscriptionCheck } from "./handlers/dailySubscriptionCheck";
import { DailyAnalyticsProccessing } from "./handlers/dailyAnalyticsProccesing";
import { AllAnalyticsProccessing } from "./handlers/allAnalyticsInsertion";
import { cors } from "hono/cors";
import { GeneratePdf } from "./handlers/generatePdf";
import { GenerateImages } from "./handlers/generateImages";
import { Env } from "./types";
import { supabaseClient } from "./lib/supabase";

const app = new Hono<{ Bindings: Env }>();

const openapi = fromHono(app, {
  docs_url: "/",
});

app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
    maxAge: 86400,
  })
);

openapi.post("/api/ai", AIGeneration);
openapi.post("/api/ocr", OCRImport);
openapi.post("/api/subscription/check", DailySubscriptionCheck);
openapi.get("/api/analytics", DailyAnalyticsProccessing);
openapi.get("/api/analytics/all", AllAnalyticsProccessing);
openapi.post("/api/generate/pdf", GeneratePdf);
openapi.post("/api/generate/images", GenerateImages);

async function handleCron(env: Env) {
  console.log("Running newsletter cron job...");
  const database = supabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  await database
    .from("product_newsletter")
    .insert([{ email: `test${Math.random().toFixed(2)}@gmail.com` }]);
}

// --- route for manual triggering
app.get("/api/cron", async (c) => {
  await handleCron(c.env);
  return c.json({ message: "Cron run manually" });
});

// --- test: http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*
// --- main export for Worker
export default {
  fetch: app.fetch, // handles HTTP requests
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // This runs automatically via Cloudflare cron trigger

    await handleCron(env);
  },
};
