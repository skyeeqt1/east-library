"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelOwnRequest } from "@/lib/student/request-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";

export interface CancelRequestButtonProps {
  requestId: string;
  /** Book title — shown in the confirmation dialog. */
  title: string;
}

/**
 * "Cancel" action for a PENDING request (FR-13, R-12 CANCELLED, design §4.7
 * — destructive confirmations go through a modal).
 *
 * Secondary-sm trigger → confirm dialog ("Keep request" secondary vs
 * "Cancel request" danger per design §4.1) → `cancelOwnRequest` server action
 * (ownership + PENDING state re-verified there and by RLS) → success toast
 * "Request cancelled." + `router.refresh()`; failures toast the exact server
 * message (e.g. "This request can no longer be cancelled." after a race).
 */
export function CancelRequestButton({
  requestId,
  title,
}: CancelRequestButtonProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  const closeDialog = () => {
    if (isPending) return;
    setOpen(false);
  };

  function handleConfirm(): void {
    startTransition(async () => {
      try {
        const result = await cancelOwnRequest(requestId);
        if (result.ok) {
          setNotice({ tone: "success", message: "Request cancelled." });
          setOpen(false);
          router.refresh();
        } else {
          setNotice({
            tone: "error",
            message: result.error ?? "Could not cancel the request. Please try again.",
          });
        }
      } catch {
        // The action redirected (session ended) — navigation is in flight.
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={isPending}
        aria-label={`Cancel request for ${title}`}
      >
        Cancel
      </Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Cancel this request?"
        description={`“${title}” will be withdrawn from the library queue. You can request the book again later.`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={isPending}>
              Keep request
            </Button>
            <Button
              size="md"
              variant="danger"
              onClick={handleConfirm}
              loading={isPending}
            >
              Cancel request
            </Button>
          </>
        }
      >
        <p>
          The library will no longer review this request. This cannot be undone.
        </p>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
