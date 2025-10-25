import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AIGeneration } from "./endpoints/aiGeneration";
import { OCRImport } from "./endpoints/ocrImport";
import { DailySubscriptionCheck } from "./endpoints/dailySubscriptionCheck";
import { DailyAnalyticsProccessing } from "./endpoints/dailyAnalyticsProccesing";
import { AllAnalyticsProccessing } from "./endpoints/allAnalyticsInsertion";
import { cors } from "hono/cors";
import { GeneratePdf } from "./endpoints/generatePdf";
import { GenerateImages } from "./endpoints/generateImages";

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

export default app;
