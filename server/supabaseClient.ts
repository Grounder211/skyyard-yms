import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client. Always uses the service_role key so the Express
// backend is the trusted, single point of authorization (requireRole guards in
// server.ts) — every table has RLS enabled with zero policies for anon/authenticated,
// so this is the only key that can read/write. Never send this key to the browser.
const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://wdghkrqyggydvbsuasst.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.warn(
    "[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Grab it from Project Settings > API on the " +
    "skyyard-yms Supabase project and add it to your .env file — the server cannot read or write " +
    "data without it (RLS blocks the anon key by design)."
  );
}

export const db = createClient(supabaseUrl, supabaseServiceKey || "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Throws with a readable message instead of returning undefined data on error —
// keeps call sites in server.ts short: `const rows = unwrap(await db.from(...).select())`
export function unwrap<T>(result: { data: T | null; error: any }): T {
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  return result.data as T;
}
