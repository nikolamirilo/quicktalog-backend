import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AIGeneration } from "./handlers/aiGeneration";
import { OCRImport } from "./handlers/ocrImport";
import { SubscriptionProcessingJob } from "./handlers/subscriptionProcessingJob";
import { cors } from "hono/cors";
import { GeneratePdf } from "./handlers/generatePdf";
import { GenerateImages } from "./handlers/generateImages";
import { AppContext, Env } from "./types";
import { supabaseClient } from "./lib/supabase";
import { AnalyticsProcessingJob } from "./handlers/analyticsProcessingJob";

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
openapi.get("/api/generate/pdf", GeneratePdf);
openapi.post("/api/generate/images", GenerateImages);

// --- test: http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const analyticsProccessingJob = new AnalyticsProcessingJob();
    await analyticsProccessingJob.handle(env, "daily");
    const subscriptionProcessingJob = new SubscriptionProcessingJob();
    await subscriptionProcessingJob.handle(env);
  },
};
