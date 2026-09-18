import { createClient } from "@supabase/supabase-js";

/** Admin client using the Supabase secret key (`sb_secret_...`) - bypasses RLS. Use only for trusted server-side operations. */
export function supabaseAdmin(host: string, secretKey: string) {
  return createClient(host, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
