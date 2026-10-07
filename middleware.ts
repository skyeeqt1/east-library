import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Route-level auth + role guard (architecture.md §4, rules.md §9).
 *
 * Layers of defence:
 *   1. middleware.ts (this file)  — UX redirects
 *   2. Postgres RLS               — data cannot leak even if this fails
 *   3. server actions             — re-verify roles before every mutation
 *
 * Phase 0 notes:
 *   - The session check is final; the role lookup is TODO-wired to the
 *     `profiles` table (see getUserRole below) and falls back to STUDENT.
 *   - /signup, /register (and friends) must 404 — R-01 / FR-02: the system
 *     exposes no self-registration route, ever.
 */

type Role = "ADMIN" | "STUDENT";

/** Paths reachable without a session. */
const PUBLIC_PATHS = new Set<string>(["/login"]);

/**
 * Paths that must render as 404 (no sign-up / no email password-reset flow).
 * R-01: accounts are created by an admin only.
 */
const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /^\/(signup|sign-up|register|register|join)(\/|$)/i,
  /^\/(forgot-password|reset-password)(\/|$)/i,
  /^\/auth\/(callback-signup|recover)(\/|$)/i,
];

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.nextUrl));
}

/** Rewrite to the internal not-found route so app/not-found.tsx renders a 404. */
function respondNotFound(req: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL("/_not-found", req.nextUrl));
}

/**
 * TODO(Phase 1): finalize the role source.
 *
 * Reads `profiles.role` (RLS allows reading your own row) and falls back to
 * the role stamped on the auth user's `app_metadata` at account creation.
 * If neither resolves (profiles table not migrated yet, RLS denies, network
 * hiccup), the role defaults to STUDENT — the safe, least-privileged choice
 * (students are redirected away from /admin/* either way).
 */
async function getUserRole(
  supabase: ReturnType<typeof createServerClient>,
  user: User,
): Promise<Role> {
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!error && profile?.role === "ADMIN") return "ADMIN";
    if (!error && profile?.role === "STUDENT") return "STUDENT";
  } catch {
    // Fall through to app_metadata / default.
  }

  const metadataRole: unknown = user.app_metadata?.role;
  return metadataRole === "ADMIN" ? "ADMIN" : "STUDENT";
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // 1) Self-registration and email password-reset paths never exist (R-01).
  if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return respondNotFound(req);
  }

  // Refresh the session before any redirect decisions (Supabase SSR pattern).
  const supabaseResponse = NextResponse.next({
    request: { headers: req.headers },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 2) Not configured — behave as signed out rather than crashing requests.
  if (!supabaseUrl || !anonKey) {
    if (PUBLIC_PATHS.has(pathname)) return supabaseResponse;
    return redirectTo(req, "/login");
  }

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser() — the session is
  // randomly refreshed during this call and cookies must be written through.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.has(pathname);

  // 3) Unauthenticated → /login (FR-01). Authenticated /login or / → role home.
  if (!user) {
    if (isPublic) return supabaseResponse;
    return redirectTo(req, "/login");
  }

  const role = await getUserRole(supabase, user);
  const homePath = role === "ADMIN" ? "/admin/dashboard" : "/dashboard";

  if (isPublic || pathname === "/") {
    return redirectTo(req, homePath);
  }

  // 4) Role guards (FR-03): ADMIN owns /admin/*, STUDENT never enters it (E10).
  //    Admins may also open /student-facing routes ("Switch dashboard").
  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return redirectTo(req, "/dashboard");
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on every route except build assets and static files.
     * The pattern must be a regex string (not a RegExp) for Next.js.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)",
  ],
};
