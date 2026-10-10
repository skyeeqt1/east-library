import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route-level auth + role guard (architecture.md §4, rules.md §9).
 *
 * Layers of defence:
 *   1. middleware.ts (this file)  — UX redirects
 *   2. Postgres RLS               — data cannot leak even if this fails
 *   3. server actions             — re-verify roles before every mutation
 *
 * Phase 1 notes:
 *   - The session check is final; the role is read from `profiles` with an
 *     `app_metadata` fallback (see resolveRole below). Verified end-to-end:
 *     ADMIN → /admin/dashboard, STUDENT → /dashboard, and a student session
 *     on /admin/* is bounced to /dashboard (E10).
 *   - /signup, /register (and friends) must 404 — R-01 / FR-02: the system
 *     exposes no self-registration route, ever.
 *
 * Performance (page-switch latency):
 *   - `auth.getClaims()` verifies the access-token JWT locally against a
 *     cached JWKS instead of `getUser()`'s per-request network round-trip.
 *   - The `profiles.role` lookup is cached per user for ROLE_CACHE_TTL_MS —
 *     only the first request per user per TTL pays the ~200-400 ms query.
 *     This layer only drives redirects; admin pages and server actions
 *     re-read `profiles` fresh on every request (the real security gate),
 *     so a stale cache entry can never grant access — at worst a role
 *     change takes up to 5 minutes to reflect in redirects.
 */

type Role = "ADMIN" | "STUDENT";

/** Narrow shape of the claims we read off the locally-verified JWT. */
interface AuthClaims {
  sub?: string;
  app_metadata?: Record<string, unknown> | null;
}

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

/** How long a resolved role may be reused inside this process (UX layer). */
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Per-process role cache keyed by user id. Single-node deployment (school
 * LAN / one server), so an in-memory Map is correct here — see also the
 * deployment note in lib/rate-limit.ts.
 */
const roleCache = new Map<string, { role: Role; expires: number }>();

function cachedRole(userId: string): Role | undefined {
  const hit = roleCache.get(userId);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    roleCache.delete(userId);
    return undefined;
  }
  return hit.role;
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.nextUrl));
}

/** Rewrite to the internal not-found route so app/not-found.tsx renders a 404. */
function respondNotFound(req: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL("/_not-found", req.nextUrl));
}

/**
 * Role source: `profiles.role` (RLS allows reading your own row), falling
 * back to the role stamped on the auth user's `app_metadata` at account
 * creation. If neither resolves (network hiccup, missing row), the role
 * defaults to STUDENT — the safe, least-privileged choice (students are
 * redirected away from /admin/* either way; app/(admin)/admin/layout.tsx
 * re-verifies the role server-side as a second layer).
 *
 * `user_metadata` is deliberately NOT consulted: unlike `app_metadata`, it is
 * writable by the authenticated user themselves, so it must never steer
 * routing.
 */
async function resolveRole(
  supabase: ReturnType<typeof createServerClient>,
  claims: AuthClaims,
): Promise<Role> {
  const userId = claims.sub;

  if (userId) {
    const hit = cachedRole(userId);
    if (hit) return hit;
  }

  if (userId) {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (!error && (profile?.role === "ADMIN" || profile?.role === "STUDENT")) {
        roleCache.set(userId, {
          role: profile.role,
          expires: Date.now() + ROLE_CACHE_TTL_MS,
        });
        return profile.role;
      }
    } catch {
      // Fall through to app_metadata / default — do NOT cache (may be stale).
    }
  }

  const metadataRole = claims.app_metadata?.role;
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

  // Do not run code between createServerClient and getClaims() — the session
  // is randomly refreshed during this call and cookies must be written through.
  // getClaims() verifies the JWT locally (cached JWKS): no network round-trip
  // for the common case, unlike getUser().
  const { data: claimData } = await supabase.auth.getClaims();
  const claims = claimData?.claims as AuthClaims | undefined;

  const isPublic = PUBLIC_PATHS.has(pathname);

  // Server-action POSTs are marked with the `Next-Action` header. A
  // middleware redirect would 307-follow the POST to /login and the client
  // would receive an HTML page where it expects an action response (silent
  // failure — e.g. "session expired mid-submit" never navigates and shows
  // nothing). Every action re-verifies session + role itself (assertAdmin /
  // getCurrentProfile / getUser — rules.md §9), so these pass through and
  // the action answers with its own redirect/state.
  const isActionPost =
    req.method === "POST" && req.headers.get("next-action") !== null;

  // 3) Unauthenticated → /login (FR-01). Authenticated /login or / → role home.
  if (!claims?.sub) {
    if (isPublic || isActionPost) return supabaseResponse;
    return redirectTo(req, "/login");
  }

  const role = await resolveRole(supabase, claims);
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
