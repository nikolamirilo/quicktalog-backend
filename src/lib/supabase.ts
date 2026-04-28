import { createClient } from "@supabase/supabase-js";

export function supabaseClient(host: string, anon_key: string) {
  const supabase = createClient(host, anon_key);
  return supabase;
}

/** Service-role client — bypasses RLS. Use only for trusted server-side operations. */
export function supabaseAdmin(host: string, service_role_key: string) {
  return createClient(host, service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
