import { createClient } from "@supabase/supabase-js";

export function supabaseClient(host: string, anon_key: string) {
  const supabase = createClient(host, anon_key);
  return supabase;
}
