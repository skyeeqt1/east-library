"use client";

import {
  useCallback,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { updateLibrarySettings } from "@/lib/admin/settings-actions";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  SETTING_LABELS,
  settingsSchema,
  type LibrarySettings,
} from "@/lib/validations/settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import { cn, formatPeso } from "@/lib/utils";

/**
 * Admin Settings form (Phase 8a — rules.md §1, §8 R-29/R-31/R-32).
 *
 * Single **save-all** form: it renders the two editable sections (loan &
 * request limits, fines) plus whatever read-only sections the server page
 * passes as `children` (admin account, audit list), with one "Save changes"
 * button at the bottom of the page.
 *
 * Behaviour:
 *   - **dirty state** — the Save button stays disabled until a field differs
 *     from the values the server rendered (`initial`), so a pristine form
 *     can never post a no-op;
 *   - client validates with the shared `settingsSchema` for instant inline
 *     feedback, then calls the `updateLibrarySettings` server action, which
 *     re-validates and re-verifies the admin role (R-31);
 *   - success → toast "Settings saved. Changed: …" (or the server's exact
 *     'No changes to save.' when the typed values coerce back to the stored
 *     ones) + `router.refresh()` to pull the new server values;
 *   - validation error → inline field errors; server error → toast with the
 *     exact server message.
 *
 * Money: the peso input edits **pesos** (step 0.01) and the schema/action
 * convert ×100 to integer centavos for storage (R-29) — see
 * lib/validations/settings.ts for the documented approach.
 */

/** Serializable props from the server page. */
export interface SettingsFormProps {
  /** Current stored rules §1 values (getLibrarySettings()). */
  initial: LibrarySettings;
  /** Read-only sections rendered inside the form, above the Save button. */
  children?: ReactNode;
}

/** Empty/non-numeric input → NaN so Zod reports the field instead of 0. */
function toNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Helper sentence for the loan period, reflecting the typed value. */
function loanPeriodHelper(days: number, fallback: number): string {
  const shown = Number.isFinite(days) && days >= 1 && days <= 90
    ? Math.round(days)
    : fallback;
  return `Students can borrow for up to ${shown} days (R-14).`;
}

export function SettingsForm({ initial, children }: SettingsFormProps) {
  const router = useRouter();
  const groupId = useId();

  /* Editable state — strings so partial input ("" / "1.") stays typeable. */
  const [loanDays, setLoanDays] = useState(String(initial.loanPeriodDays));
  const [feePesos, setFeePesos] = useState(
    (initial.overdueFeePerDayCentavos / 100).toFixed(2),
  );
  const [maxActiveLoans, setMaxActiveLoans] = useState(
    String(initial.maxActiveLoans),
  );
  const [maxPendingRequests, setMaxPendingRequests] = useState(
    String(initial.maxPendingRequests),
  );
  const [blockOnUnpaidFines, setBlockOnUnpaidFines] = useState(
    initial.blockOnUnpaidFines,
  );

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  /* ---- dirty state (disabled until a field actually changes) ---------- */
  const parsed = {
    loanPeriodDays: toNumber(loanDays),
    overdueFeePesos: toNumber(feePesos),
    maxActiveLoans: toNumber(maxActiveLoans),
    maxPendingRequests: toNumber(maxPendingRequests),
    blockOnUnpaidFines,
  };
  const dirty =
    parsed.loanPeriodDays !== initial.loanPeriodDays ||
    Math.round(parsed.overdueFeePesos * 100) !== initial.overdueFeePerDayCentavos ||
    parsed.maxActiveLoans !== initial.maxActiveLoans ||
    parsed.maxPendingRequests !== initial.maxPendingRequests ||
    parsed.blockOnUnpaidFines !== initial.blockOnUnpaidFines;

  /* Live helper values (fall back to the stored value while typing junk). */
  const activeLoansHint =
    Number.isFinite(parsed.maxActiveLoans) &&
    parsed.maxActiveLoans >= 1 &&
    parsed.maxActiveLoans <= 10
      ? Math.round(parsed.maxActiveLoans)
      : initial.maxActiveLoans;
  const pendingHint =
    Number.isFinite(parsed.maxPendingRequests) &&
    parsed.maxPendingRequests >= 1 &&
    parsed.maxPendingRequests <= 10
      ? Math.round(parsed.maxPendingRequests)
      : initial.maxPendingRequests;
  const feeHint = Number.isFinite(parsed.overdueFeePesos)
    ? formatPeso(Math.round(parsed.overdueFeePesos * 100))
    : formatPeso(initial.overdueFeePerDayCentavos);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(null);

    // Client-side validation for instant inline errors (the action
    // re-runs the exact same schema server-side — R-31).
    const candidate = {
      loanPeriodDays: parsed.loanPeriodDays,
      overdueFeePesos: parsed.overdueFeePesos,
      maxActiveLoans: parsed.maxActiveLoans,
      maxPendingRequests: parsed.maxPendingRequests,
      blockOnUnpaidFines: parsed.blockOnUnpaidFines,
    };
    const result = settingsSchema.safeParse(candidate);
    if (!result.success) {
      setFieldErrors(fieldErrorsFromZod(result.error));
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const response = await updateLibrarySettings(result.data);
      if (response.ok) {
        const changedLabels = response.changed
          .map((key) =>
            key in SETTING_LABELS
              ? SETTING_LABELS[key as keyof typeof SETTING_LABELS]
              : key,
          )
          .join(", ");
        setNotice({
          tone: "success",
          message: response.changed.length
            ? `${response.message} Changed: ${changedLabels}.`
            : response.message,
        });
        router.refresh();
      } else if (response.fieldErrors) {
        setFieldErrors(response.fieldErrors);
      } else {
        // Exact server text surfaced in an error toast.
        setNotice({
          tone: "error",
          message: response.error ?? "Could not save the settings. Please try again.",
        });
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {/* -------------------------------------------------------------- */}
      {/* Section 1 — Loan & request limits (rules §1, R-14 / R-09)        */}
      {/* -------------------------------------------------------------- */}
      <section aria-labelledby={`${groupId}-loan-heading`} className="flex flex-col gap-4">
        <h2
          id={`${groupId}-loan-heading`}
          className="text-lg font-semibold text-gray-900"
        >
          Loan &amp; request limits
        </h2>
        <Card>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field
              label="Loan period (days)"
              name="loanPeriodDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              step={1}
              required
              disabled={saving}
              value={loanDays}
              onChange={(event) => setLoanDays(event.target.value)}
              helper={loanPeriodHelper(parsed.loanPeriodDays, initial.loanPeriodDays)}
              error={fieldErrors.loanPeriodDays}
            />
            <Field
              label="Max active loans"
              name="maxActiveLoans"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              step={1}
              required
              disabled={saving}
              value={maxActiveLoans}
              onChange={(event) => setMaxActiveLoans(event.target.value)}
              helper={`Each student may have at most ${activeLoansHint} active loans.`}
              error={fieldErrors.maxActiveLoans}
            />
            <Field
              label="Max pending requests"
              name="maxPendingRequests"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              step={1}
              required
              disabled={saving}
              value={maxPendingRequests}
              onChange={(event) => setMaxPendingRequests(event.target.value)}
              helper={`Each student may have at most ${pendingHint} pending requests.`}
              error={fieldErrors.maxPendingRequests}
            />
          </div>

          {/* Danger note — honest scoping of the change (E3). */}
          <p className="mt-4 flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-25 px-3 py-2 text-xs font-medium text-warning-700">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Applies to loans released after saving — existing loans keep
              their due date (E3).
            </span>
          </p>
        </Card>
      </section>

      {/* -------------------------------------------------------------- */}
      {/* Section 2 — Fines (rules §1, R-18 / R-25 / R-29)                 */}
      {/* -------------------------------------------------------------- */}
      <section aria-labelledby={`${groupId}-fines-heading`} className="flex flex-col gap-4">
        <h2
          id={`${groupId}-fines-heading`}
          className="text-lg font-semibold text-gray-900"
        >
          Fines
        </h2>
        <Card>
          <div className="flex flex-col gap-5">
            <Field
              label="Overdue fee per day"
              name="overdueFeePesos"
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step={0.01}
              required
              disabled={saving}
              leading="₱"
              value={feePesos}
              onChange={(event) => setFeePesos(event.target.value)}
              helper={`Charged per overdue day, swept daily at 00:05 Manila (R-18). Currently ${feeHint} per day.`}
              error={fieldErrors.overdueFeePesos}
            />

            {/* Editable toggle — block_on_unpaid_fines (R-25 / FR-20) */}
            <label
              htmlFor={`${groupId}-block-fines`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors duration-fast",
                "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-500",
                blockOnUnpaidFines
                  ? "border-warning-500/40 bg-warning-25"
                  : "border-gray-200 bg-white hover:bg-gray-25",
                saving && "pointer-events-none opacity-60",
              )}
            >
              <input
                id={`${groupId}-block-fines`}
                type="checkbox"
                checked={blockOnUnpaidFines}
                disabled={saving}
                aria-describedby={`${groupId}-block-fines-desc`}
                onChange={(event) => setBlockOnUnpaidFines(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">
                  Block requests with unpaid fines
                </span>
                <span
                  id={`${groupId}-block-fines-desc`}
                  className={cn(
                    "block text-xs",
                    blockOnUnpaidFines ? "text-warning-700" : "text-gray-500",
                  )}
                >
                  {blockOnUnpaidFines
                    ? "Students with unpaid fines cannot request books (R-25)."
                    : "Students with unpaid fines CAN request books while this is off."}
                </span>
              </span>
            </label>

            {/* Read-only toggle — allow_renewals is fixed off in v1 (rules §1) */}
            <label
              htmlFor={`${groupId}-renewals`}
              className={cn(
                "flex items-start gap-3 rounded-md border border-gray-200 bg-gray-25 px-4 py-3 opacity-70",
                "cursor-not-allowed",
              )}
            >
              <input
                id={`${groupId}-renewals`}
                type="checkbox"
                checked={initial.allowRenewals}
                disabled
                aria-describedby={`${groupId}-renewals-desc`}
                className="mt-0.5 size-4 shrink-0 accent-primary-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-700">
                  Allow renewals
                </span>
                <span
                  id={`${groupId}-renewals-desc`}
                  className="block text-xs text-gray-500"
                >
                  Renewals are not available in v1.
                </span>
              </span>
            </label>

            {/* Danger note — fee changes are forward-looking only (E3). */}
            <p className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-25 px-3 py-2 text-xs font-medium text-warning-700">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Applies to future overdue calculations only — recorded fines
                keep their amount (E3, R-29).
              </span>
            </p>
          </div>
        </Card>
      </section>

      {/* Read-only sections from the server page (account, audit trail). */}
      {children}

      {/* Single save-all button (dirty-gated). */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
        <Button
          type="submit"
          size="lg"
          loading={saving}
          disabled={!dirty || saving}
          title={dirty ? undefined : "No changes to save."}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </form>
  );
}
