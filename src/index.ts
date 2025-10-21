import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AIGeneration } from "./endpoints/aiGeneration";

const app = new Hono<{ Bindings: Env }>();

const openapi = fromHono(app, {
  docs_url: "/",
});

openapi.post("/api/ai", AIGeneration);
openapi.post("/api/ocr", AIGeneration);
openapi.get("/api/subscription/check", AIGeneration);
openapi.get("/api/analytics/", AIGeneration);
openapi.get("/api/analytics/all", AIGeneration);

export default app;
