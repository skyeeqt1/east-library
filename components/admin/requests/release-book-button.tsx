"use client";

import { useCallback, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { releaseLoan } from "@/lib/admin/loan-actions";
import { fetchReleaseCandidates } from "@/components/admin/requests/candidates-action";
import {
  LOAN_MESSAGES,
  type ReleaseCandidates,
} from "@/lib/validations/loan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface ReleasableRequest {
  id: string;
  /** Used in the dialog title and screen-reader labels. */
  student_name: string;
  title: string;
}

/**
 * Modal gate text — the exact `LOAN_MESSAGES` strings, decided from the
 * candidates payload (rules.md §10 / R-12…R-14):
 *
 *   - `null` (bad id / gone / read failed) or 0 AVAILABLE copies
 *       → 'No copies available — request cannot be approved.'
 *   - PENDING / DECLINED / CANCELLED / EXPIRED
 *       → the matching pre-check string ('Approve the request first.' …)
 *   - APPROVED with copies → `null` (the picker renders)
 */
function gateMessage(candidates: ReleaseCandidates | null): string | null {
  if (!candidates) return LOAN_MESSAGES.noCopies;
  if (candidates.status !== "APPROVED") {
    switch (candidates.status) {
      case "PENDING":
        return LOAN_MESSAGES.needsApproval;
      case "DECLINED":
        return LOAN_MESSAGES.wasDeclined;
      case "CANCELLED":
        return LOAN_MESSAGES.wasCancelled;
      case "EXPIRED":
        return LOAN_MESSAGES.wasExpired;
      default:
        return LOAN_MESSAGES.notApproved;
    }
  }
  if (candidates.copies.length === 0) return LOAN_MESSAGES.noCopies;
  return null;
}

/**
 * "Release book" action for one APPROVED row in the decided feed (R-14:
 * approval does not start the clock — the desk release does).
 *
 * Click → fetches `getReleaseCandidates(requestId)` (via the guarded
 * "use server" wrapper) and opens the modal (design §4.7): book title/author
 * plus every AVAILABLE copy as a radio group (barcode + "Available"). Confirm
 * runs `releaseLoan({ requestId, copyId })` — SQL computes `due_date =
 * release + 7 days`, flips the copy to ON_LOAN and links the request — then
 * toasts `Book released — due in 7 days.` and refreshes the feed.
 *
 * Failure keeps the modal open and shows the **exact** server text inline
 * (LOAN_MESSAGES / SQL `RAISE EXCEPTION`, e.g. E6 "This request has already
 * been released." or the R-13/E1 no-copies string).
 */
export function ReleaseBookButton({ request }: { request: ReleasableRequest }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<ReleaseCandidates | null>(null);
  const [copyId, setCopyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  const gate = loading ? null : gateMessage(candidates);

  async function handleOpen(): Promise<void> {
    setOpen(true);
    setLoading(true);
    setError(null);
    setCandidates(null);
    setCopyId("");
    try {
      const result = await fetchReleaseCandidates(request.id);
      setCandidates(result);
      if (result && result.copies.length > 0) {
        setCopyId(result.copies[0].id);
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
      setCandidates(null);
    } finally {
      setLoading(false);
    }
  }

  function handleClose(): void {
    if (submitting) return;
    setOpen(false);
    setError(null);
  }

  function handleCopyChange(event: ChangeEvent<HTMLInputElement>): void {
    setCopyId(event.target.value);
  }

  async function handleSubmit(): Promise<void> {
    if (!copyId || gate) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await releaseLoan({ requestId: request.id, copyId });
      if (result.ok) {
        setNotice({ tone: "success", message: "Book released — due in 7 days." });
        setOpen(false);
        router.refresh();
      } else {
        // Exact server text (LOAN_MESSAGES / mapped SQL RAISE EXCEPTION).
        setError(
          result.error ?? LOAN_MESSAGES.releaseFailed,
        );
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
        aria-label={`Release book for ${request.title} to ${request.student_name}`}
      >
        Release book
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Release book"
        description={`${request.title} — ${request.student_name}`}
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
            <Button
              size="md"
              onClick={handleSubmit}
              loading={submitting}
              disabled={loading || gate !== null || copyId === ""}
            >
              {submitting ? "Releasing…" : "Release book"}
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading available copies…
          </p>
        ) : gate !== null ? (
          <div
            role="alert"
            className="rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
          >
            {gate}
          </div>
        ) : candidates ? (
          <>
            <div className="rounded-md bg-gray-50 px-4 py-3">
              <p className="text-sm font-medium text-gray-900">
                {candidates.title}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {candidates.author}
              </p>
            </div>

            <fieldset className="mt-4" disabled={submitting}>
              <legend className="text-sm font-medium text-gray-700">
                Choose the copy to hand over
              </legend>
              <div className="mt-2 flex flex-col gap-2">
                {candidates.copies.map((copy) => {
                  const selected = copy.id === copyId;
                  return (
                    <label
                      key={copy.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors duration-fast",
                        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-500",
                        selected
                          ? "border-primary-500 bg-primary-25"
                          : "border-gray-200 bg-white hover:bg-gray-25",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <input
                          type="radio"
                          name="release-copy"
                          value={copy.id}
                          checked={selected}
                          onChange={handleCopyChange}
                          className="size-4 shrink-0 accent-primary-500"
                        />
                        <span className="truncate font-mono text-sm text-gray-900">
                          {copy.barcode ?? "Unlabeled copy"}
                        </span>
                      </span>
                      <Badge tone="success">Available</Badge>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                The chosen copy flips to Borrowed out and is due back in 7 days
                (R-14 — due date computed in SQL).
              </p>
            </fieldset>

            {error ? (
              <div
                role="alert"
                className="mt-4 rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
              >
                {error}
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
