import type { Env } from "../types";

export type RevalidateRequest = {
  names?: string[];
  dashboard?: boolean;
};

/**
 * Asks the app to revalidate cached pages. With no names the app revalidates
 * the catalogue list; `dashboard` also revalidates the dashboard.
 */
export async function revalidateData(
  env: Pick<Env, "APP_URL" | "REVALIDATE_SECRET">,
  body: RevalidateRequest = {},
) {
  if (!env.REVALIDATE_SECRET) {
    throw new Error("REVALIDATE_SECRET not configured");
  }
  const res = await fetch(`${env.APP_URL}/api/revalidate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-revalidate-secret": env.REVALIDATE_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Revalidation failed with status ${res.status}`);
  }
}

/** Constant-time comparison of two secrets (hashes first so lengths match). */
export async function secretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
) {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** True when the JOBS_PAUSED kill switch is on. */
export function jobsPaused(env: Pick<Env, "JOBS_PAUSED">) {
  return env.JOBS_PAUSED?.trim().toLowerCase() === "true";
}
