/**
 * ============================================================================
 *  Supabase — server-side clients (App Router)
 * ============================================================================
 *
 * Environment variables used by this module:
 *
 *   NEXT_PUBLIC_SUPABASE_URL        Supabase project URL (also public — used by
 *                                   the browser client in lib/supabase/browser.ts)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   Supabase anon/public API key. Safe to expose
 *                                   to the browser: Row Level Security governs
 *                                   what it may do.
 *   SUPABASE_SERVICE_ROLE_KEY       Server-only service-role key. NEVER expose,
 *                                   NEVER prefix with NEXT_PUBLIC_. Grants RLS
 *                                   bypass — see getServiceClient() below.
 *
 * These belong in `.env.local` (git-ignored). No `.env*` files are committed to
 * this repository by design.
 * ============================================================================
 */

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env.local (see the comment block at the top of lib/supabase/server.ts).`,
    );
  }
  return value;
}

/**
 * Cookie-aware Supabase client for Server Components, Server Actions and
 * Route Handlers. The session is read from / written to the request cookies so
 * the user's auth state survives across the server boundary.
 */
export async function createClient(): Promise<SupabaseClient> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The Server Component called `setAll` — cookie writes are only
          // allowed in a Server Action or Route Handler. Safe to ignore when
          // we are simply refreshing a session during a page render.
        }
      },
    },
  });
}

/**
 * Server-only admin client using the SERVICE ROLE key.
 *
 * ⚠️  This client BYPASSES Row Level Security. It must only ever be called from
 *     inside admin-guarded Server Actions (e.g. account creation, request
 *     approval, fine recording) where the caller's role has already been
 *     re-verified on the server (R-03, R-31). Never import it into a client
 *     component or return it from an API route reachable without a role check.
 *
 * TODO(Phase 1): call sites land with account management — always pair with an
 * `assertAdmin()` guard (lib/auth/guards.ts) before any mutation.
 */
export function getServiceClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
