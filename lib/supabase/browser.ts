import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser (anon) Supabase client.
 *
 * Used for reads/writes made directly from the client — Row Level Security
 * applies. Never put the service-role key here.
 *
 * Expected environment variables (see lib/supabase/server.ts for the full list):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.",
    );
  }

  return createBrowserClient(url, anonKey);
}
