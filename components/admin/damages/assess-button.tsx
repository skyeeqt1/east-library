"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { assessDamage } from "@/lib/admin/damage-actions";
import {
  FINE_MESSAGES,
  assessDamageSchema,
} from "@/lib/validations/fine";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { formatPeso } from "@/lib/utils";

/** Serializable slice of an assessable (RETURNED + DAMAGED) loan. */
export interface AssessableLoan {
  /** `loans.id` — the `loanId` argument of `assessDamage()` (R-23). */
  id: string;
  student_name: string;
  student_number: string | null;
  title: string;
  author: string;
  /** ISO timestamp of the damaged return. */
  returned_at: string;
  /** Book's replacement value in centavos (R-08) — the assessment preview. */
  replacement_value_centavos: number;
}

const DESCRIPTION_MAX = 500;

const RETURNED_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatReturned(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : RETURNED_FORMAT.format(parsed);
}

/**
 * "Assess" action for a book returned as DAMAGED with no report yet
 * (FR-18 / R-22 / R-23).
 *
 * Opens the assessment modal (design §4.7): book/student summary, the
 * **assessed value preview** (the book's `replacement_value_centavos` — SQL
 * re-derives the real figure, the client never sends an amount, R-31), a
 * required description (3–500 characters, validated with the shared
 * `assessDamageSchema` so the inline message matches the server byte for
 * byte) and an optional photo URL.
 *
 * Confirm runs `assessDamage` — the single `assess_damage()` RPC that, in one
 * transaction, inserts the `damage_reports` row, upserts the UNPAID DAMAGE
 * fine for the book's replacement value (R-22) and writes the audit row. The
 * success toast reports the amount SQL returned: *"Damage assessed — student
 * fined ₱X."* then the queue refreshes and the row becomes a PENDING report.
 *
 * Failures surface the **exact** server message (e.g.
 * FINE_MESSAGES.alreadyAssessed, FINE_MESSAGES.notDamagedReturn) in an error
 * toast with the modal left open for a retry.
 */
export function AssessButton({ loan }: { loan: AssessableLoan }) {
  const router = useRouter();
  const descriptionId = useId();
  const photoId = useId();

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [descriptionError, setDescriptionError] = useState<string | undefined>(
    undefined,
  );
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  function handleOpen(): void {
    setDescription("");
    setPhotoUrl("");
    setDescriptionError(undefined);
    setOpen(true);
  }

  function handleClose(): void {
    if (submitting) return;
    setOpen(false);
  }

  function handleDescriptionChange(
    event: ChangeEvent<HTMLTextAreaElement>,
  ): void {
    setDescription(event.target.value.slice(0, DESCRIPTION_MAX));
    if (descriptionError) setDescriptionError(undefined);
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>): void {
    setPhotoUrl(event.target.value.slice(0, 500));
  }

  async function handleSubmit(): Promise<void> {
    // Client-side pre-check with the shared schema so the inline message
    // matches the server exactly (R-31 — the action re-validates anyway).
    const parsed = assessDamageSchema.safeParse({
      loanId: loan.id,
      description,
      photoUrl,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues.find((item) =>
        item.path.includes("description"),
      );
      if (issue) {
        setDescriptionError(issue.message);
        return;
      }
      // photoUrl problem — surface it in a toast (still the exact schema
      // string); the description field has no error of its own.
      const photoIssue = parsed.error.issues.find((item) =>
        item.path.includes("photoUrl"),
      );
      if (photoIssue) {
        setNotice({ tone: "error", message: photoIssue.message });
      }
      return;
    }
    const payload = parsed.data;

    setSubmitting(true);
    try {
      const response = await assessDamage(payload);
      if (response.ok) {
        setOpen(false);
        setNotice({
          tone: "success",
          message: `Damage assessed — student fined ${formatPeso(
            response.data.fineAmount,
          )}.`,
        });
        router.refresh();
      } else if (response.fieldErrors?.description) {
        setDescriptionError(response.fieldErrors.description);
      } else {
        // Exact server text — e.g. FINE_MESSAGES.alreadyAssessed (R-21/E6).
        setNotice({
          tone: "error",
          message: response.error ?? FINE_MESSAGES.assessFailed,
        });
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={handleOpen}
        disabled={submitting}
        aria-label={`Assess damage for ${loan.title} returned by ${loan.student_name}`}
      >
        Assess
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Assess damage"
        description={`${loan.title} — ${loan.student_name}`}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="md" onClick={handleSubmit} loading={submitting}>
              {submitting ? "Saving…" : "Save assessment"}
            </Button>
          </>
        }
      >
        {/* What came back damaged (design §4.4 meta rows) */}
        <dl className="grid grid-cols-1 gap-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Book</dt>
            <dd className="min-w-0 text-right text-sm text-gray-700">
              <span className="block truncate text-sm font-medium text-gray-900">
                {loan.title}
              </span>
              <span className="block truncate text-xs font-normal text-gray-500">
                {loan.author}
              </span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Student</dt>
            <dd className="min-w-0 text-right text-sm text-gray-700">
              <span className="block truncate">{loan.student_name}</span>
              {loan.student_number ? (
                <span className="block font-mono text-xs text-gray-500">
                  {loan.student_number}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Returned</dt>
            <dd className="text-sm text-gray-700">
              {formatReturned(loan.returned_at)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">
              Assessed value (preview)
            </dt>
            <dd className="text-2xl font-semibold tracking-tight text-gray-900">
              {formatPeso(loan.replacement_value_centavos)}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <label
            htmlFor={descriptionId}
            className="block text-sm font-medium text-gray-700"
          >
            What is damaged?{" "}
            <span className="text-error-500" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={handleDescriptionChange}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            disabled={submitting}
            required
            placeholder="e.g. Water-damaged cover and warped pages."
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={
              descriptionError ? `${descriptionId}-error` : `${descriptionId}-helper`
            }
            className={
              descriptionError
                ? "mt-2 block w-full rounded-md border border-error-500 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 transition-shadow duration-fast ease-standard focus:border-error-500 focus:outline-none focus:shadow-focus disabled:opacity-50"
                : "mt-2 block w-full rounded-md border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 transition-shadow duration-fast ease-standard focus:border-primary-500 focus:outline-none focus:shadow-focus disabled:opacity-50"
            }
          />
          {descriptionError ? (
            <p
              id={`${descriptionId}-error`}
              aria-live="polite"
              className="mt-2 text-xs text-error-500"
            >
              {descriptionError}
            </p>
          ) : (
            <p id={`${descriptionId}-helper`} className="mt-2 text-xs text-gray-500">
              Stored on the damage report (R-23). {description.length}/
              {DESCRIPTION_MAX} characters.
            </p>
          )}
        </div>

        <div className="mt-4">
          <label
            htmlFor={photoId}
            className="block text-sm font-medium text-gray-700"
          >
            Photo URL{" "}
            <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            id={photoId}
            type="text"
            value={photoUrl}
            onChange={handlePhotoChange}
            maxLength={500}
            disabled={submitting}
            placeholder="damage-photos/… or https://…"
            aria-describedby={`${photoId}-helper`}
            className="mt-2 block h-10 w-full rounded-md border border-gray-300 bg-white px-3.5 text-sm text-gray-900 placeholder:text-gray-500 transition-shadow duration-fast ease-standard focus:border-primary-500 focus:outline-none focus:shadow-focus disabled:opacity-50"
          />
          <p id={`${photoId}-helper`} className="mt-2 text-xs text-gray-500">
            Shown as a thumbnail on the damage report.
          </p>
        </div>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
