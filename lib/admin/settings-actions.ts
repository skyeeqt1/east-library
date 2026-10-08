"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/guards";
import { createClient, getServiceClient } from "@/lib/supabase/server";
import {
  settingBool,
  settingInt,
} from "@/lib/catalog/settings-read";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  SETTINGS_KEY_BY_FIELD,
  settingsMessages,
  settingsSchema,
  type SettingsActionResult,
  type SettingsInput,
} from "@/lib/validations/settings";

/**
 * ============================================================================
 *  Admin settings action — updateLibrarySettings (Phase 8a, rules.md §1/§8)
 * ============================================================================
 *
 * The single write path for the library configuration. Follows
 * lib/admin/fine-actions.ts / book-actions.ts:
 *
 *   1. `assertAdmin()` FIRST (session → profiles.role → redirect when not
 *      ADMIN; §9 matrix: "Change settings (fee rate, loan days)" is
 *      ADMIN-only — a student never reaches this code, R-31/E10),
 *   2. re-validates the payload with `settingsSchema` (R-31 — client values
 *      are never trusted). The schema is `strict()`, so a payload carrying a
 *      key outside the five editable fields is REJECTED outright — no
 *      unknown `settings` row can ever be written from here (R-29/R-31),
 *   3. reads the CURRENT values through the cookie-aware admin client and
 *      diffs them against the payload — no-op saves write nothing and return
 *      `{ ok: true, changed: [], message: 'No changes to save.' }`,
 *   4. upserts only the CHANGED keys (RLS "settings: admin manages" grants
 *      admins full CRUD — no service-role bypass needed for the settings
 *      write itself; `value` is stored jsonb — ints as numbers, the boolean
 *      as a boolean, matching the seed shape read by SQL's
 *      `(value #>> '{}')::int` casts),
 *   5. appends ONE `audit_logs` row `action = 'settings-change'` (rules §8 /
 *      R-32) via the **service-role client** (`audit_logs` has no client
 *      INSERT policy, schema §4) with a `before`/`after` snapshot limited to
 *      the keys that actually changed, then
 *   6. revalidates the settings page plus the pages whose live reads depend
 *      on configuration (`/dashboard/catalog` eligibility thresholds,
 *      `/admin/requests` queue context).
 *
 * ⚠️  Money: the payload carries `overdueFeePesos` (peso, ≤ 2 decimals); this
 *     action converts ×100 to an **integer centavos** value for
 *     `overdue_fee_per_day_centavos` (R-29 — SQL reads the integer directly).
 *
 * ⚠️  Changing `loan_period_days` only affects loans released AFTER the save
 *     (`release_loan` reads the setting at release time) and changing the fee
 *     only affects fines computed by FUTURE sweeps/returns (R-18/R-20 read it
 *     at compute time). Existing due dates and recorded fine amounts are
 *     never rewritten (E3).
 */

/** Routes whose cached reads depend on the configuration (revalidated on save). */
const SETTINGS_PATHS = [
  "/admin/settings",
  "/dashboard/catalog",
  "/admin/requests",
] as const;

/* ------------------------------------------------------------------ */
/* Result helpers                                                      */
/* ------------------------------------------------------------------ */

function invalid(fieldErrors: Record<string, string>): SettingsActionResult {
  return { ok: false, fieldErrors };
}

function failed(message: string): SettingsActionResult {
  return { ok: false, error: message };
}

/**
 * Snapshot of the rows to diff: `key → raw jsonb value` for the five
 * editable keys only (never reads or exposes other keys).
 */
async function readCurrentValues(): Promise<
  { values: Map<string, unknown>; error: string | null }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", Object.values(SETTINGS_KEY_BY_FIELD));

  if (error) return { values: new Map(), error: error.message };
  const values = new Map<string, unknown>();
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    values.set(row.key, row.value);
  }
  return { values, error: null };
}

/* ------------------------------------------------------------------ */
/* updateLibrarySettings                                               */
/* ------------------------------------------------------------------ */

/**
 * Save the admin Settings form (rules §1, §8 R-29/R-31/R-32).
 *
 * Input is `unknown` and parsed with `settingsSchema` — the client form's
 * values are re-validated on the server, and unknown keys are rejected.
 *
 * Behaviour:
 *   - validation failure → `{ ok: false, fieldErrors }` (inline errors),
 *   - read/write failure → `{ ok: false, error }` (exact server message),
 *   - no differences     → `{ ok: true, changed: [], message: 'No changes
 *     to save.' }` — nothing is written and no audit row is appended,
 *   - success            → `{ ok: true, changed: [...keys], message:
 *     'Settings saved.' }` — one upsert per changed key + ONE
 *     `settings-change` audit row (R-32).
 *
 * `changed` contains `settings.key` values (e.g. `loan_period_days`) so the
 * toast can list them via `SETTING_LABELS`.
 */
export async function updateLibrarySettings(
  input: unknown,
): Promise<SettingsActionResult> {
  const { adminId } = await assertAdmin();

  /* ---- 1. validate (R-31; unknown keys rejected by the strict schema) -- */
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFromZod(parsed.error));
  const desired: SettingsInput = parsed.data;

  /* ---- 2. read current values & diff --------------------------------- */
  const { values: current, error: readError } = await readCurrentValues();
  if (readError) return failed(settingsMessages.loadFailed);

  const centavos = Math.round(desired.overdueFeePesos * 100);
  const desiredByKey: Record<string, number | boolean> = {
    loan_period_days: desired.loanPeriodDays,
    overdue_fee_per_day_centavos: centavos,
    max_active_loans: desired.maxActiveLoans,
    max_pending_requests: desired.maxPendingRequests,
    block_on_unpaid_fines: desired.blockOnUnpaidFines,
  };

  const changed: string[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const rows: Array<{ key: string; value: number | boolean }> = [];

  for (const [key, next] of Object.entries(desiredByKey)) {
    const raw = current.get(key);
    // Coerce the stored value with the same rules SQL/readers use so a
    // '7' (string) row compares equal to the number 7 (no false diffs).
    const prev =
      typeof next === "boolean"
        ? settingBool(raw, next)
        : settingInt(raw, next);
    if (prev === next) continue;

    changed.push(key);
    before[key] = prev;
    after[key] = next;
    rows.push({ key, value: next });
  }

  /* ---- 3. no-op save -------------------------------------------------- */
  if (changed.length === 0) {
    return { ok: true, changed: [], message: settingsMessages.noChanges };
  }

  /* ---- 4. upsert the changed keys (admin RLS) ------------------------- */
  const supabase = await createClient();
  const stamped = rows.map((row) => ({
    ...row,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  }));
  const { error: upsertError } = await supabase
    .from("settings")
    .upsert(stamped, { onConflict: "key" });
  if (upsertError) return failed(settingsMessages.saveFailed);

  /* ---- 5. ONE audit row (R-32, service client, best-effort) ----------- */
  try {
    const service = getServiceClient();
    const { error: auditError } = await service.from("audit_logs").insert({
      actor_id: adminId,
      action: "settings-change",
      entity_type: "settings",
      entity_id: null,
      before,
      after,
    });
    if (auditError) console.error("audit_logs insert failed:", auditError.message);
  } catch (cause) {
    // Missing env / network — the settings write already succeeded.
    console.error("audit_logs insert failed:", cause);
  }

  /* ---- 6. revalidate the pages that read configuration ---------------- */
  for (const path of SETTINGS_PATHS) revalidatePath(path);

  return { ok: true, changed, message: settingsMessages.saved };
}
