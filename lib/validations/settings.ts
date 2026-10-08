import { z } from "zod";

/**
 * ============================================================================
 *  Library settings validation, types & messages (Phase 8a — rules.md §1)
 * ============================================================================
 *
 * The admin Settings page (app/(admin)/admin/settings) edits exactly the
 * rules §1 configuration keys. This module is deliberately free of
 * `server-only` / "use server" markers (same contract as
 * lib/validations/fine.ts) so the server action, the server page **and** the
 * client form can all import the schema, result types and error strings.
 *
 * ## Money approach — PESOS in the payload, CENTAVOS in the database (R-29)
 *
 * ONE consistent approach, documented here as the source of truth:
 *
 *   - the schema field is `overdueFeePesos` — a **peso** number in
 *     [0, 1000] with at most 2 decimal places (step 0.01). The UI edits and
 *     displays pesos (`₱10.00`) because the input is a human-facing field;
 *   - `updateLibrarySettings` (lib/admin/settings-actions.ts) multiplies by
 *     100 and stores an **integer centavos** value in
 *     `settings.overdue_fee_per_day_centavos` — SQL (`run_overdue_sweep`,
 *     `record_return`) reads that integer directly (R-29/R-31);
 *   - reads convert centavos → pesos only for display (`formatPeso()`).
 *
 * So: pesos cross the network boundary, centavos live in the database.
 *
 * ## Keys not in this schema
 *
 * `allow_renewals` (rules §1, default `false`) is **read-only in v1** — no
 * renewals exist, so it is displayed disabled and never submitted;
 * `request_expiry_days` (schema §2.8 seed) is system-owned and is never
 * editable here either. The schema is `strict()` so any payload carrying an
 * unknown key is rejected outright (R-29/R-31 — server-side authority: only
 * the documented keys may ever be written).
 */

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/**
 * Editable settings payload — rules §1 keys:
 *
 *   loanPeriodDays          → loan_period_days            (1–90,  default 7)
 *   overdueFeePesos         → overdue_fee_per_day_centavos (0–1000 pesos,
 *                                                stored ×100 as centavos)
 *   maxActiveLoans          → max_active_loans             (1–10,  default 3)
 *   maxPendingRequests      → max_pending_requests         (1–10,  default 3)
 *   blockOnUnpaidFines      → block_on_unpaid_fines        (boolean, default true)
 *
 * `strict()` rejects unknown keys (no silently-dropped extras).
 */
export const settingsSchema = z
  .strictObject({
    loanPeriodDays: z
      .number("Enter a loan period.")
      .int("Loan period must be a whole number of days.")
      .min(1, "Loan period must be at least 1 day.")
      .max(90, "Loan period must be 90 days or fewer."),
    overdueFeePesos: z
      .number("Enter an overdue fee.")
      .min(0, "Overdue fee cannot be negative.")
      .max(1000, "Overdue fee must be ₱1,000.00 or less per day.")
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
        "Overdue fee allows centavos only (at most 2 decimal places, e.g. 10.00).",
      ),
    maxActiveLoans: z
      .number("Enter the active-loan limit.")
      .int("Active-loan limit must be a whole number.")
      .min(1, "Active-loan limit must be at least 1.")
      .max(10, "Active-loan limit must be 10 or fewer."),
    maxPendingRequests: z
      .number("Enter the pending-request limit.")
      .int("Pending-request limit must be a whole number.")
      .min(1, "Pending-request limit must be at least 1.")
      .max(10, "Pending-request limit must be 10 or fewer."),
    blockOnUnpaidFines: z.boolean("Block-on-unpaid-fines must be true or false."),
  });

/** Parsed (server-ready) payload. */
export type SettingsInput = z.infer<typeof settingsSchema>;

/* ------------------------------------------------------------------ */
/* Key ↔ field mapping (schema §2.8 / rules §1)                        */
/* ------------------------------------------------------------------ */

/** The `settings.key` this payload field writes. */
export const SETTINGS_KEY_BY_FIELD = {
  loanPeriodDays: "loan_period_days",
  overdueFeePesos: "overdue_fee_per_day_centavos",
  maxActiveLoans: "max_active_loans",
  maxPendingRequests: "max_pending_requests",
  blockOnUnpaidFines: "block_on_unpaid_fines",
} as const;

/**
 * Human labels for every editable key — used by the success toast
 * ("Settings saved. Changed: Loan period, Overdue fee per day.") and by the
 * audit list's before → after summary.
 */
export const SETTING_LABELS: Record<(typeof SETTINGS_KEY_BY_FIELD)[keyof typeof SETTINGS_KEY_BY_FIELD], string> = {
  loan_period_days: "Loan period",
  overdue_fee_per_day_centavos: "Overdue fee per day",
  max_active_loans: "Max active loans",
  max_pending_requests: "Max pending requests",
  block_on_unpaid_fines: "Block on unpaid fines",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * The rules §1 configuration snapshot returned by `getLibrarySettings()`
 * (lib/catalog/settings-read.ts) — defaults applied per key. Lives here (not
 * in the server-only reader) so the client form can import the type without
 * pulling `server-only` into the browser bundle.
 */
export interface LibrarySettings {
  /** `loan_period_days` — default 7, valid range 1–90 (R-14). */
  loanPeriodDays: number;
  /** `overdue_fee_per_day_centavos` — default 1000 (₱10.00/day, R-18/R-29). */
  overdueFeePerDayCentavos: number;
  /** `max_active_loans` — default 3, valid range 1–10 (R-09.5). */
  maxActiveLoans: number;
  /** `max_pending_requests` — default 3, valid range 1–10 (R-09.4). */
  maxPendingRequests: number;
  /** `allow_renewals` — rules §1 default false; v1 never renews, read-only. */
  allowRenewals: boolean;
  /** `block_on_unpaid_fines` — default true, hard-blocks requests (R-25). */
  blockOnUnpaidFines: boolean;
}

/**
 * Result shape returned by `updateLibrarySettings` — the same union pattern
 * as `FineActionResult` (lib/validations/fine.ts):
 *   success → `{ ok: true, changed, message }`
 *   failure → `{ ok: false, error?, fieldErrors? }`
 */
export type SettingsActionResult =
  | {
      ok: true;
      /** `settings.key` values actually written this save (empty = no-op). */
      changed: string[];
      /** 'Settings saved.' or 'No changes to save.' */
      message: string;
    }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

/* ------------------------------------------------------------------ */
/* User-facing messages                                                */
/* ------------------------------------------------------------------ */

/**
 * Exact strings surfaced by lib/admin/settings-actions.ts — kept here so the
 * client form never has to import a "use server" module for its copy.
 */
export const settingsMessages = {
  /** Settings read failed (page shows the error card). */
  loadFailed: "Could not load the settings. Please try again.",
  /** No-op save: payload validated but every value equals the stored one. */
  noChanges: "No changes to save.",
  /** Successful save (client appends the changed-key list). */
  saved: "Settings saved.",
  /** Upsert failed (RLS / network / unexpected). */
  saveFailed: "Could not save the settings. Please try again.",
} as const;
