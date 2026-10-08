import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { LibrarySettings } from "@/lib/validations/settings";

/**
 * ============================================================================
 *  Library settings reads — server-only helpers (Phase 8a, rules.md §1)
 * ============================================================================
 *
 * Plain async functions: **no `"use server"` directive** (same contract as
 * lib/catalog/availability.ts / requests-read.ts) — call them from Server
 * Components, route handlers or server actions, never from a client component.
 *
 * Contents:
 *   - `settingInt` / `settingBool` — jsonb coercion shared by every settings
 *     reader (extracted from lib/catalog/requests-read.ts so the shape rules
 *     live in ONE place — `settings.value` is jsonb `number | string |
 *     boolean`);
 *   - `getLibrarySettings()` — the typed rules §1 snapshot with defaults
 *     applied per key, used by the admin Settings page and available to any
 *     server-side rule that needs the full set;
 *   - `getSettingsAudit(limit)` — recent `settings-change` audit rows
 *     (R-32 / rules §8) for the "Recent configuration changes" list.
 *
 * Reads go through the cookie-aware anon client so RLS applies (schema §4):
 *   - `settings` has a public SELECT policy ("settings: readable"),
 *   - `audit_logs` has an **admin SELECT policy** ("audit_logs: admin reads")
 *     — so, like every other admin read in this codebase, the session client
 *     suffices; the service-role client is NOT needed for these reads.
 *
 * ⚠️  `audit_logs.actor_id` is intentionally NOT a foreign key since
 *     migration 0005 (append-only rows can't ride ON DELETE SET NULL), so
 *     PostgREST cannot embed `profiles` — actor names are resolved with a
 *     second `profiles` query instead of a join.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** (The `LibrarySettings` snapshot type lives in lib/validations/settings.ts
 *  so client form code can import it without pulling in `server-only`.) */

/** One `settings-change` row of the audit trail (R-32), actor resolved. */
export interface SettingsAuditRow {
  id: string;
  action: string;
  /** `audit_logs.before` jsonb snapshot (may be null for legacy rows). */
  before: Record<string, unknown> | null;
  /** `audit_logs.after` jsonb snapshot (may be null for legacy rows). */
  after: Record<string, unknown> | null;
  created_at: string;
  /** `profiles.full_name` of `actor_id` when the account still exists. */
  actor_name: string | null;
  /** The actor uuid snapshot (null when the action wrote no actor). */
  actor_id: string | null;
}

/* ------------------------------------------------------------------ */
/* jsonb coercion (shared with lib/catalog/requests-read.ts)           */
/* ------------------------------------------------------------------ */

/**
 * Coerce a `settings.value` jsonb payload to an int, falling back when the
 * row is missing or unparsable. Seed rows arrive as **numbers**; hand-written
 * or restored rows may arrive as strings ('7') — both are accepted.
 */
export function settingInt(raw: unknown, fallback: number): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Coerce a `settings.value` jsonb payload to a boolean ('true' accepted). */
export function settingBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/* getLibrarySettings — rules §1 snapshot                              */
/* ------------------------------------------------------------------ */

/** Every `settings.key` this module reads (6 keys — rules §1). */
const SETTINGS_KEYS = [
  "loan_period_days",
  "overdue_fee_per_day_centavos",
  "max_active_loans",
  "max_pending_requests",
  "allow_renewals",
  "block_on_unpaid_fines",
] as const;

/**
 * Read the full rules §1 configuration in ONE query, applying the documented
 * default per key when the row is missing or unparsable:
 *
 *   loan_period_days=7 · overdue_fee_per_day_centavos=1000 ·
 *   max_active_loans=3 · max_pending_requests=3 ·
 *   allow_renewals=false · block_on_unpaid_fines=true
 *
 * Throws only when the underlying read fails (same contract as the catalog
 * read helpers) — a missing/odd row is NOT an error, the default wins.
 *
 * `overdueFeePerDayCentavos` is returned in **integer centavos** (R-29);
 * convert ×/÷ 100 only at the UI boundary (`formatPeso()` / the peso input).
 */
export async function getLibrarySettings(): Promise<LibrarySettings> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", SETTINGS_KEYS);

  if (error) {
    throw new Error(
      `Could not read the library settings. (${error.message})`,
    );
  }

  const values = new Map<string, unknown>();
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    values.set(row.key, row.value);
  }

  return {
    loanPeriodDays: settingInt(values.get("loan_period_days"), 7),
    overdueFeePerDayCentavos: settingInt(
      values.get("overdue_fee_per_day_centavos"),
      1000,
    ),
    maxActiveLoans: settingInt(values.get("max_active_loans"), 3),
    maxPendingRequests: settingInt(values.get("max_pending_requests"), 3),
    allowRenewals: settingBool(values.get("allow_renewals"), false),
    blockOnUnpaidFines: settingBool(values.get("block_on_unpaid_fines"), true),
  };
}

/* ------------------------------------------------------------------ */
/* getSettingsAudit — recent `settings-change` rows (R-32)             */
/* ------------------------------------------------------------------ */

/**
 * The most recent `settings-change` audit rows, newest first (R-32 / rules
 * §8 — `settings-change` is one of the mandatory audit actions).
 *
 * `limit` defaults to 10 and is clamped to 1–100. Because
 * `audit_logs.actor_id` carries no FK (migration 0005), actor display names
 * are resolved with a second `profiles` read — admins can read every profile
 * (schema §4), and a deleted account simply renders as an unresolved uuid.
 *
 * Returns `[]` when nothing has been audited yet (the page then shows its
 * empty state) and throws only when the read itself fails.
 */
export async function getSettingsAudit(
  limit = 10,
): Promise<SettingsAuditRow[]> {
  const take = Math.min(100, Math.max(1, Math.floor(limit)));
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, actor_id, before, after, created_at")
    .eq("action", "settings-change")
    .order("created_at", { ascending: false })
    .limit(take);

  if (error) {
    throw new Error(`Could not read the settings audit trail. (${error.message})`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    action: string;
    actor_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    created_at: string;
  }>;
  if (rows.length === 0) return [];

  // Second pass: resolve actor_id → full_name (no FK to embed through).
  const actorIds = [
    ...new Set(
      rows
        .map((row) => row.actor_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    if (!profilesError) {
      for (const profile of (profiles ?? []) as {
        id: string;
        full_name: string;
      }[]) {
        names.set(profile.id, profile.full_name);
      }
    }
    // A failed name lookup only degrades to "unknown actor" — the audit row
    // itself already exists, so this never fails the page read.
  }

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    before: row.before,
    after: row.after,
    created_at: row.created_at,
    actor_id: row.actor_id,
    actor_name: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
  }));
}
