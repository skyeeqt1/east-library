import { z } from "zod";

/**
 * ============================================================================
 *  Fine & damage validation, enums and shared types (Phase 5 — rules.md §5–§7)
 * ============================================================================
 *
 * Shapes:
 *   assessDamageSchema  — admin records a damage assessment on a RETURNED
 *                         DAMAGED loan (R-22/R-23, FR-18). The AMOUNT is never
 *                         in the payload: `assess_damage()` in SQL derives it
 *                         from the book's `replacement_value_centavos` (R-08/
 *                         R-22/R-31 — client values are never trusted).
 *   recordPaymentSchema — admin records cash / replacement received for one
 *                         UNPAID fine (R-28: the system records, it does not
 *                         collect; FR-19).
 *   waiveFineSchema     — admin waives a fine. The written reason is
 *                         **REQUIRED** (R-24 / FR-19 — DB also enforces it
 *                         with the `waiver_needs_reason` constraint).
 *   resolveDamageSchema — R-23 resolution of a damage report: the student
 *                         either replaced the book or paid its value.
 *
 * The server actions in lib/admin/fine-actions.ts and lib/admin/damage-actions.ts
 * parse `unknown` with these schemas before touching the database (R-31),
 * mirroring lib/validations/loan.ts / request.ts.
 *
 * Money never appears in a write schema: amounts are computed exclusively in
 * SQL (R-18/R-22/R-31) and always carried as integer centavos (R-29) — the UI
 * formats them with `formatPeso()` from lib/utils.ts.
 *
 * This module is deliberately free of `server-only` / "use server" markers so
 * server actions, server components **and** client form code can import the
 * schemas, result types and error strings.
 */

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

/** `damage_reports.photo_url` — Storage path under `damage-photos/`
 *  (schema.md §2.7) or a full http(s) URL; empty string → undefined.
 *  Mirrors `coverUrlSchema` in lib/validations/book.ts. */
const STORAGE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

function isAcceptablePhotoUrl(value: string): boolean {
  if (STORAGE_PATH_PATTERN.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const photoUrlSchema = z
  .string()
  .trim()
  .max(500, "Photo URL must be 500 characters or fewer.")
  .refine((value) => value === "" || isAcceptablePhotoUrl(value), {
    message: "Enter a valid image URL, or leave it empty.",
  })
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * Record a damage assessment (FR-18, R-22/R-23). `loanId` must be a loan the
 * admin already returned with `condition_on_return = 'DAMAGED'` — the action
 * pre-checks that state machine before calling the `assess_damage()` RPC.
 */
export const assessDamageSchema = z.object({
  loanId: z.string().uuid(),
  description: z
    .string()
    .trim()
    .min(3, "Describe the damage (at least 3 characters).")
    .max(500, "Description must be 500 characters or fewer."),
  photoUrl: photoUrlSchema,
});

/**
 * Record payment received for one fine (FR-19, R-28).
 * `method` is what settled it: `CASH` (money at the desk) or `REPLACEMENT`
 * (a replacement copy was handed over — R-22). The system records, never
 * collects (prd.md §9 constraint).
 */
export const recordPaymentSchema = z.object({
  fineId: z.string().uuid(),
  method: z.enum(["CASH", "REPLACEMENT"]),
});

/**
 * Waive a fine (R-24 / FR-19): admin-only **and** a written reason is
 * mandatory — "only with a written `waive_reason`; waives are audit-logged".
 * The DB constraint `waiver_needs_reason` backstops this at the row level.
 */
export const waiveFineSchema = z.object({
  fineId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Enter a reason for the waiver (at least 3 characters).")
    .max(300, "Reason must be 300 characters or fewer."),
});

/**
 * Resolve a damage report (R-23): which report (`damageId`) and how it was
 * settled — `REPLACEMENT` (a replacement copy was received) or `PAYMENT`
 * (the full value was paid in cash). Both settle the DAMAGE fine and return
 * the copy to circulation (lib/admin/damage-actions.ts).
 */
export const resolveDamageSchema = z.object({
  damageId: z.string().uuid(),
  resolution: z.enum(["REPLACEMENT", "PAYMENT"]),
});

/** Parsed (DB-ready) payloads. */
export type AssessDamageInput = z.infer<typeof assessDamageSchema>;
export type RecordFinePaymentInput = z.infer<typeof recordPaymentSchema>;
export type WaiveFineInput = z.infer<typeof waiveFineSchema>;
export type ResolveDamageInput = z.infer<typeof resolveDamageSchema>;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** `fines.status` values — schema.md §2.6 / rules.md §10 fine state machine. */
export const FINE_STATUSES = ["UNPAID", "PAID", "WAIVED"] as const;

export type FineStatus = (typeof FINE_STATUSES)[number];

/** Type guard for a `fines.status` string. */
export function isFineStatus(value: string): value is FineStatus {
  return (FINE_STATUSES as readonly string[]).includes(value);
}

/** `fines.type` values — schema.md §2.6 (R-18 OVERDUE, R-22 DAMAGE). */
export const FINE_TYPES = ["OVERDUE", "DAMAGE"] as const;

export type FineType = (typeof FINE_TYPES)[number];

/** Type guard for a `fines.type` string. */
export function isFineType(value: string): value is FineType {
  return (FINE_TYPES as readonly string[]).includes(value);
}

/** `fines.paid_method` values — R-22 (`method = 'cash' | 'replacement'`). */
export const FINE_PAYMENT_METHODS = ["CASH", "REPLACEMENT"] as const;

export type FinePaymentMethod = (typeof FINE_PAYMENT_METHODS)[number];

/** `damage_reports.status` values — schema.md §2.7 / R-23. */
export const DAMAGE_REPORT_STATUSES = ["PENDING", "RESOLVED"] as const;

export type DamageReportStatus = (typeof DAMAGE_REPORT_STATUSES)[number];

/** Type guard for a `damage_reports.status` string. */
export function isDamageReportStatus(value: string): value is DamageReportStatus {
  return (DAMAGE_REPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * Result shape returned by every Phase 5 server action — the same union
 * pattern as `LoanActionResult` (lib/validations/loan.ts):
 *   success → `{ ok: true, data }`
 *   failure → `{ ok: false, error?, fieldErrors? }`
 */
export type FineActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

/** `data` returned by a successful `assessDamage`. */
export interface AssessDamageResult {
  /** The new `damage_reports.id`. */
  damageId: string;
  /** The DAMAGE fine created by `assess_damage()` (R-22). */
  fineId: string;
  /** DAMAGE fine in **integer centavos** (R-29) — the book's replacement
   *  value at assessment time; format with `formatPeso()` in the UI. */
  fineAmount: number;
}

/** `data` returned by a successful `recordFinePayment`. */
export interface RecordFinePaymentResult {
  fineId: string;
  status: FineStatus; // always "PAID"
  paidMethod: FinePaymentMethod;
  /** The settled amount in integer centavos (R-29). */
  amountCentavos: number;
}

/** `data` returned by a successful `waiveFine`. */
export interface WaiveFineResult {
  fineId: string;
  status: FineStatus; // always "WAIVED"
}

/** `data` returned by a successful `resolveDamage` (R-23). */
export interface ResolveDamageResult {
  damageId: string;
  /** The DAMAGE fine settled by the resolution, or null when the loan had
   *  no DAMAGE fine (report resolved anyway). */
  fineId: string | null;
  fineStatus: FineStatus | null;
  /** `paid_method` written by the automatic settlement, or null. */
  paidMethod: FinePaymentMethod | null;
  /** The physical copy restored to circulation (R-23 → AVAILABLE). */
  copyId: string;
  copyStatus: "AVAILABLE";
}

/* ------------------------------------------------------------------ */
/* User-facing messages (exact strings used by the server actions)     */
/* ------------------------------------------------------------------ */

/**
 * Exact error strings surfaced by lib/admin/fine-actions.ts and
 * lib/admin/damage-actions.ts. Kept here so the UI task can reference them
 * without importing a "use server" module.
 */
export const FINE_MESSAGES = {
  /** Fine id not in the table (bad id / already gone). */
  fineNotFound: "Fine not found.",
  /** Fine is already PAID or WAIVED (§10: UNPAID is the only settleable
   *  state; the conditional UPDATE re-checks it for races, E6). */
  alreadySettled: "This fine has already been settled.",
  /** Read/pre-check failed before any write. */
  loadFineFailed: "Could not load the fine. Please try again.",
  loadLoanFailed: "Could not load the loan. Please try again.",
  loadDamageFailed: "Could not load the damage report. Please try again.",
  /** Assess: loan id not in the table. */
  loanNotFound: "Loan not found.",
  /** Assess pre-check (R-23/E5): the loan is not a DAMAGED return. */
  notDamagedReturn: "Only books returned as DAMAGED can be assessed.",
  /** Assess pre-check (R-21: one assessment per loan — also raised by
   *  `assess_damage()` in SQL, byte-identical). */
  alreadyAssessed: "Damage already assessed for this loan.",
  /** Resolve: damage report id not in the table. */
  damageReportNotFound: "Damage report not found.",
  /** Resolve: report already RESOLVED (E6-style single decision). */
  alreadyResolved: "This damage report has already been resolved.",
  /** RPC failed for an unexpected reason (mapped SQL text wins when present). */
  assessFailed: "Could not record the damage assessment. Please try again.",
  paymentFailed: "Could not record the payment. Please try again.",
  waiveFailed: "Could not waive the fine. Please try again.",
  resolveFailed: "Could not resolve the damage report. Please try again.",
} as const;
