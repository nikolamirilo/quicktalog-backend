import { fromHono } from "chanfana";
import { Hono } from "hono";
import { SubscriptionProcessingJob } from "./handlers/subscriptionProcessingJob";
import { GeneratePdf } from "./handlers/generatePdf";
import { Env } from "./types";
import { AnalyticsProcessingJob } from "./handlers/analyticsProcessingJob";
import { CleanupImages } from "./handlers/cleanupImages";
import { AnalyticsBackfill } from "./handlers/analyticsBackfill";
import { jobsPaused, secretMatches } from "./helpers";

const app = new Hono<{ Bindings: Env }>();

/**
 * The admin token of a request: `Authorization: Bearer <token>`, or the password of Basic
 * credentials (any user name), which is what a browser sends after its login prompt.
 */
function adminTokenOf(header: string): string | null {
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (!header.startsWith("Basic ")) return null;
  try {
    const credentials = atob(header.slice(6));
    const colon = credentials.indexOf(":");
    return colon >= 0 ? credentials.slice(colon + 1) : null;
  } catch {
    return null;
  }
}

// Every HTTP route is an admin tool, the docs included: require the admin token. The Basic
// challenge makes a browser ask for it, so the docs at / open in a browser. No CORS, since
// no other site calls this worker.
app.use("/*", async (c, next) => {
  const token = adminTokenOf(c.req.header("authorization") ?? "");
  if (!(await secretMatches(token, c.env.WORKER_ADMIN_TOKEN))) {
    return c.json({ error: "Unauthorized" }, 401, {
      "WWW-Authenticate": 'Basic realm="quicktalog-backend", charset="UTF-8"',
    });
  }
  await next();
});

const openapi = fromHono(app, {
  docs_url: "/",
  schema: {
    info: { title: "Quicktalog backend", version: "1.0.0" },
    security: [{ adminToken: [] }],
  },
});

openapi.registry.registerComponent("securitySchemes", "adminToken", {
  type: "http",
  scheme: "bearer",
  description: "WORKER_ADMIN_TOKEN",
});

openapi.get("/api/generate/pdf", GeneratePdf);
openapi.get("/api/images/cleanup", CleanupImages);
openapi.post("/api/analytics/backfill", AnalyticsBackfill);

/** The first of `triggers.crons` in wrangler.jsonc; the other trigger runs the plan checks only. */
const DAILY_CRON = "0 3 * * *";

// --- test: http://127.0.0.1:8787/__scheduled?cron=0+3+*+*+*  (or 0+11,19+*+*+*)
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (jobsPaused(env)) {
      console.warn("Scheduled jobs paused (JOBS_PAUSED=true); skipping run");
      return;
    }
    const failures: unknown[] = [];
    // Analytics is a daily import and runs first, since the plan checks read its rows; the
    // plan checks also run between imports. A failed import must not skip them.
    if (event.cron === DAILY_CRON) {
      try {
        await new AnalyticsProcessingJob().handle(env);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await new SubscriptionProcessingJob().handle(env);
    } catch (error) {
      failures.push(error);
    }
    // Rethrown so the run shows as failed in the Workers dashboard instead of passing silently.
    if (failures.length > 0) {
      throw new AggregateError(failures, "Scheduled job failed");
    }
  },
};
