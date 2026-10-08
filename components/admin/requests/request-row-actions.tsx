"use client";

import {
  useCallback,
  useId,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { approveRequest, declineRequest } from "@/lib/admin/request-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";

/** Serializable slice of a pending row this row's actions need. */
export interface DecidableRequest {
  id: string;
  /** Used in confirm dialogs and screen-reader labels. */
  student_name: string;
  title: string;
}

/** declineRequestSchema mirror (R-31: the server re-validates the same cap). */
const REASON_MAX = 300;

/**
 * Pending-row actions (design §5 — "priority list with inline Approve /
 * Decline"): Approve primary-sm button + Decline secondary-sm button opening
 * the optional-reason modal (design §4.7: 480px dialog, Esc/backdrop close).
 *
 * Both mutations run in a `useTransition` against the guarded server actions
 * (`lib/admin/request-actions.ts` — `assertAdmin()` + R-15 single-decision
 * rule). Failures surface the **exact** server message in an error toast
 * (US-3: 0 copies at approval time → *"No copies available — request cannot
 * be approved."* while the row stays PENDING), successes toast and
 * `router.refresh()` the queue.
 */
export function RequestRowActions({ request }: { request: DecidableRequest }) {
  const router = useRouter();
  const reasonId = useId();

  const [isPending, startTransition] = useTransition();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  const closeDecline = () => {
    if (declining) return;
    setDeclineOpen(false);
    setDeclineError(undefined);
    setReason("");
  };

  function handleApprove(): void {
    startTransition(async () => {
      try {
        const result = await approveRequest(request.id);
        if (result.ok) {
          setNotice({ tone: "success", message: "Request approved." });
          router.refresh();
        } else {
          // Exact server text — e.g. the R-13 no-copies message (US-3).
          setNotice({
            tone: "error",
            message: result.error ?? "Could not approve the request. Please try again.",
          });
        }
      } catch {
        // The action redirected (session ended) — navigation is in flight.
      }
    });
  }

  async function handleDeclineSubmit(): Promise<void> {
    setDeclining(true);
    setDeclineError(undefined);
    try {
      const result = await declineRequest({
        requestId: request.id,
        reason: reason.trim(),
      });
      if (result.ok) {
        setNotice({ tone: "success", message: "Request declined." });
        setDeclineOpen(false);
        setReason("");
        router.refresh();
      } else if (result.fieldErrors?.reason) {
        setDeclineError(result.fieldErrors.reason);
      } else {
        setDeclineError(
          result.error ?? "Could not decline the request. Please try again.",
        );
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setDeclining(false);
    }
  }

  function handleReasonChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setReason(event.target.value.slice(0, REASON_MAX));
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={isPending || declineOpen}
          aria-label={`Approve request for ${request.title} from ${request.student_name}`}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDeclineOpen(true)}
          disabled={isPending || declineOpen}
          aria-label={`Decline request for ${request.title} from ${request.student_name}`}
        >
          Decline
        </Button>
      </div>

      <Modal
        open={declineOpen}
        onClose={closeDecline}
        title="Decline request"
        description={`${request.title} — ${request.student_name}`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDecline} disabled={declining}>
              Keep pending
            </Button>
            <Button
              size="md"
              variant="danger"
              onClick={handleDeclineSubmit}
              loading={declining}
            >
              Decline request
            </Button>
          </>
        }
      >
        {declineError ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
          >
            {declineError}
          </div>
        ) : null}

        <label
          htmlFor={reasonId}
          className="block text-sm font-medium text-gray-700"
        >
          Reason{" "}
          <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id={reasonId}
          value={reason}
          onChange={handleReasonChange}
          maxLength={REASON_MAX}
          rows={3}
          disabled={declining}
          placeholder="e.g. The last copy is reserved for another student."
          aria-describedby={`${reasonId}-helper`}
          className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 transition-shadow duration-fast ease-standard focus:border-primary-500 focus:outline-none focus:shadow-focus disabled:opacity-50"
        />
        <p id={`${reasonId}-helper`} className="mt-2 text-xs text-gray-500">
          Stored on the request and shown to the student.{" "}
          {reason.length}/{REASON_MAX} characters.
        </p>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
