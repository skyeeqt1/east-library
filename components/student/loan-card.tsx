import { Badge, toneForStatus } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Check, Clock, Info, TriangleAlert } from "lucide-react";
import {
  CountdownChip,
  countdownFor,
  withOwedAmount,
} from "@/components/student/countdown-chip";
import { ReturnBookButton } from "@/components/student/return-book-button";
import type { StudentLoanRow } from "@/lib/catalog/loans-read";
import { formatPeso } from "@/lib/utils";
import type { LoanStatus } from "@/lib/validations/loan";

/**
 * Friendly badge text per `loans.status` (design §2.1 map lives in badge.tsx:
 * ACTIVE = primary · OVERDUE = error · RETURNED = success).
 */
const STATUS_LABELS: Record<LoanStatus, string> = {
  ACTIVE: "Active",
  OVERDUE: "Overdue",
  RETURNED: "Returned",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/** Design §8 fallback cover: violet block with the title's initials. */
function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "📖";
  const first = words[0]?.charAt(0) ?? "";
  const second = words.length > 1 ? (words[1]?.charAt(0) ?? "") : first;
  return (first + second).toUpperCase();
}

/**
 * One loan as a compact list row (design §6 — dense single-line layout):
 *
 *   [AB]  A Brief History of Time                    ● Active   [Return book]
 *         Stephen W. Hawking · ESCR-EF0322-001
 *         Released Oct 10, 2026 · Due Oct 17, 2026 · ⏱ 7 days left
 *
 * Countdown colours come from the shared `countdown-chip` rule (green >3d ·
 * orange 1–3d · red due-today/overdue with the live ₱ owed when an UNPAID
 * fine exists). Status pills, the Return button / "Return requested" chip and
 * any fine notices sit in the same row or as compact strips below it — no
 * floating whitespace. Server component: plain row data, no client code.
 */
export function LoanCard({ row }: { row: StudentLoanRow }) {
  const fine = row.fine;
  const countdown = withOwedAmount(countdownFor(row), fine);
  /** Overdue but the daily sweep (R-18) has not recorded a fine row yet. */
  const overdueWithoutFine =
    row.status !== "RETURNED" &&
    row.days_late !== undefined &&
    row.days_late > 0 &&
    fine === null;
  const isOpen = row.status !== "RETURNED";
  /** A compact strip under the row — only when there is something to say. */
  const hasStrip =
    row.condition_on_return === "DAMAGED" ||
    fine !== null ||
    overdueWithoutFine ||
    (row.status === "RETURNED" && row.returned_at !== null);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        {/* Cover placeholder — violet block with title initials (design §8) */}
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-semibold text-primary-700"
        >
          {initialsOf(row.title)}
        </span>

        {/* Title / author / barcode */}
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="truncate text-sm font-semibold text-gray-900">
            {row.title}
          </h3>
          <p className="truncate text-xs text-gray-500">
            {row.author}
            {row.barcode ? (
              <span className="ml-1.5 font-mono">{row.barcode}</span>
            ) : null}
          </p>
        </div>

        {/* Released — compact label/value pair (hidden on the narrowest screens) */}
        <div className="hidden items-baseline gap-1.5 sm:flex">
          <span className="text-xs font-medium text-gray-500">Released</span>
          <span className="text-sm text-gray-700">
            {formatDate(row.released_at)}
          </span>
        </div>

        {/* Due — label/value pair + the live countdown chip on the same line */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-medium text-gray-500">Due</span>
          <span className="text-sm font-semibold text-gray-900">
            {formatDate(row.due_date)}
          </span>
        </div>
        {countdown ? <CountdownChip countdown={countdown} /> : null}

        {/* Status pill + row action (early return / requested chip) */}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={toneForStatus(row.status)}>
            {STATUS_LABELS[row.status]}
          </Badge>
          {isOpen ? (
            row.return_requested_at ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-info-500/30 bg-info-25 px-2 py-1 text-xs font-medium text-info-700">
                <Info className="size-3.5 shrink-0" aria-hidden="true" />
                Return requested
              </span>
            ) : (
              <ReturnBookButton loanId={row.id} title={row.title} />
            )
          ) : null}
        </div>
      </div>

      {/* Compact strips: return receipt · damage · fine state (design §6/§8) */}
      {hasStrip ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 text-xs sm:text-sm">
          {row.status === "RETURNED" && row.returned_at ? (
            <p className="text-gray-500">
              {row.condition_on_return === "LOST"
                ? `Marked lost ${formatDate(row.returned_at)} — replacement charge on My Penalties.`
                : `Returned ${formatDate(row.returned_at)}${
                    row.condition_on_return === "DAMAGED"
                      ? " · Condition: Damaged"
                      : ""
                  }`}
            </p>
          ) : null}

          {/* Phase 5 (FR-18) — a damaged return still owes a resolution */}
          {row.condition_on_return === "DAMAGED" ? (
            <p className="flex items-start gap-2 font-medium text-warning-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                This book was returned as DAMAGED — replacement/payment pending.
              </span>
            </p>
          ) : null}

          {/* Live ₱ owed — UNPAID warns in error red, PAID confirms in green */}
          {fine && fine.status === "UNPAID" ? (
            <p className="flex items-start gap-2 font-medium text-error-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {`Overdue fine: ${formatPeso(fine.amount_centavos)} (${
                  fine.days_late ?? row.days_late ?? 0
                } ${(fine.days_late ?? row.days_late ?? 0) === 1 ? "day" : "days"}) — settle at the library`}
              </span>
            </p>
          ) : fine && fine.status === "PAID" ? (
            <p className="flex items-center gap-2 font-medium text-success-700">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {`Overdue fine: ${formatPeso(fine.amount_centavos)} — Paid`}
              </span>
            </p>
          ) : fine ? (
            <p className="flex items-center gap-2 font-medium text-gray-700">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {`Overdue fine: ${formatPeso(fine.amount_centavos)} — Waived`}
              </span>
            </p>
          ) : overdueWithoutFine ? (
            // R-18: fines are upserted by the daily sweep — same-day overdue
            // has no amount yet, so say that instead of showing a fake ₱0.
            <p className="flex items-center gap-2 font-medium text-gray-700">
              <Clock className="size-4 shrink-0" aria-hidden="true" />
              <span>No fine recorded yet — overdue fines update daily.</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
