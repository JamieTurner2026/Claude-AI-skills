import { createClient } from "@supabase/supabase-js";

// Only the public (publishable/anon) key belongs in the browser. Service-role keys go in
// Supabase edge function secrets, never in VITE_* variables.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  console.warn("Supabase env vars missing: copy .env.example to .env.local and fill them in.");
}

export const supabase = createClient(url ?? "http://localhost:54321", key ?? "missing-key");
