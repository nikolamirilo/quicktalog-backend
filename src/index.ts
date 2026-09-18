import { fromHono } from "chanfana";
import { Hono } from "hono";
import { SubscriptionProcessingJob } from "./handlers/subscriptionProcessingJob";
import { GeneratePdf } from "./handlers/generatePdf";
import { Env } from "./types";
import { AnalyticsProcessingJob } from "./handlers/analyticsProcessingJob";
import { CleanupImages } from "./handlers/cleanupImages";
import { jobsPaused, secretMatches } from "./helpers";

const app = new Hono<{ Bindings: Env }>();

// Every HTTP route is an admin tool: require the bearer token. No CORS, since
// browsers never call this worker.
app.use("/*", async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!(await secretMatches(token, c.env.WORKER_ADMIN_TOKEN))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const openapi = fromHono(app, {
  docs_url: "/",
});

openapi.get("/api/generate/pdf", GeneratePdf);
openapi.get("/api/images/cleanup", CleanupImages);

// --- test: http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (jobsPaused(env)) {
      console.log("Scheduled jobs paused (JOBS_PAUSED=true); skipping run");
      return;
    }
    const analyticsProccessingJob = new AnalyticsProcessingJob();
    await analyticsProccessingJob.handle(env, "daily");
    const subscriptionProcessingJob = new SubscriptionProcessingJob();
    await subscriptionProcessingJob.handle(env);
  },
};
