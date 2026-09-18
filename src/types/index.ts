import type { Context } from "hono";

export type Env = {
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_URL: string;
  APP_URL: string;
  POSTHOG_HOST: string;
  POSTHOG_API_KEY: string;
  POSTHOG_PROJECT_ID: string;
  UPLOADTHING_TOKEN: string;
  MYBROWSER: Fetcher;
  database: D1Database;
  ENVIRONMENT: "test" | "prod";
  /** Shared with the app's `/api/revalidate` route. */
  REVALIDATE_SECRET: string;
  /** Bearer token required on every HTTP route of this worker. */
  WORKER_ADMIN_TOKEN: string;
  /** "true" skips the scheduled jobs (kill switch, e.g. during the cutover). */
  JOBS_PAUSED?: string;
};

export type AppContext = Context<{ Bindings: Env }>;
