import { createClient } from "@supabase/supabase-js";

/** Service-role client - bypasses RLS. Use only for trusted server-side operations. */
export function supabaseAdmin(host: string, service_role_key: string) {
  return createClient(host, service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
