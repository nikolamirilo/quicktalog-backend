import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AIGeneration } from "./handlers/aiGeneration";
import { OCRImport } from "./handlers/ocrImport";
import { SubscriptionProcessingJob } from "./handlers/subscriptionProcessingJob";
import { cors } from "hono/cors";
import { GeneratePdf } from "./handlers/generatePdf";
import { AppContext, Env } from "./types";
import { AnalyticsProcessingJob } from "./handlers/analyticsProcessingJob";
import { CleanupImages } from "./handlers/cleanupImages";

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
openapi.get("/api/images/cleanup", CleanupImages);

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
