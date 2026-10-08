import { Badge, toneForStatus } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Check, Clock, TriangleAlert } from "lucide-react";
import type { StudentLoanRow } from "@/lib/catalog/loans-read";
import { cn, formatPeso } from "@/lib/utils";
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

type Countdown = { tone: "success" | "warning" | "error"; text: string };

/**
 * Due countdown chip — design §6 colors, **exact**:
 *   >3 days → success (green) · 1–3 days → warning (orange) ·
 *   due today / overdue → error (red), with a clock icon per §6.
 * Day figures come from the Manila date-only math in
 * `lib/catalog/loans-read.ts`; RETURNED rows get no chip.
 */
function countdownOf(row: StudentLoanRow): Countdown | null {
  if (row.status === "RETURNED") return null;
  if (row.days_late !== undefined && row.days_late > 0) {
    return {
      tone: "error",
      text: `${row.days_late} ${row.days_late === 1 ? "day" : "days"} overdue`,
    };
  }
  const left = row.days_remaining;
  if (left === undefined) return null;
  if (left === 0) return { tone: "error", text: "Due today" };
  if (left <= 3) {
    return { tone: "warning", text: `${left} ${left === 1 ? "day" : "days"} left` };
  }
  return { tone: "success", text: `${left} days left` };
}

const CHIP_TONES: Record<Countdown["tone"], string> = {
  success: "bg-success-25 text-success-700",
  warning: "bg-warning-25 text-warning-700",
  error: "bg-error-25 text-error-700",
};

/**
 * One loan as a countdown card (design §6 — card-based, countdown-first:
 * cover initials · title/author · barcode · Released · big Due date + chip ·
 * status pill · live ₱ owed).
 *
 * Server component: everything rendered here is plain row data — only the
 * mutation buttons elsewhere in the app are client code.
 */
export function LoanCard({ row }: { row: StudentLoanRow }) {
  const countdown = countdownOf(row);
  const fine = row.fine;

  return (
    <Card padded={false}>
      <div className="flex gap-4 p-5 sm:p-6">
        {/* Cover placeholder — violet block with title initials (design §8) */}
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-semibold text-primary-700"
        >
          {initialsOf(row.title)}
        </span>

        <div className="min-w-0 flex-1">
          {/* Header: title/author + status pill (design §2.1 status → color) */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">{row.title}</h3>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {row.author}
              </p>
              {row.barcode ? (
                <p className="mt-0.5 font-mono text-xs text-gray-500">
                  {row.barcode}
                </p>
              ) : null}
            </div>
            <Badge tone={toneForStatus(row.status)}>
              {STATUS_LABELS[row.status]}
            </Badge>
          </div>

          {/* Released / Due + the countdown chip */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gray-500">Released</p>
              <p className="mt-0.5 text-sm text-gray-700">
                {formatDate(row.released_at)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Due</p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-gray-900">
                {formatDate(row.due_date)}
              </p>
              {countdown ? (
                <span
                  className={cn(
                    "mt-1.5 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                    CHIP_TONES[countdown.tone],
                  )}
                >
                  <Clock className="size-3 shrink-0" aria-hidden="true" />
                  {countdown.text}
                </span>
              ) : null}
            </div>
          </div>

          {row.status === "RETURNED" && row.returned_at ? (
            <p className="mt-3 text-xs text-gray-500">
              Returned {formatDate(row.returned_at)}
              {row.condition_on_return === "DAMAGED" ? " · Condition: Damaged" : null}
            </p>
          ) : null}

          {/* Phase 5 (FR-18) — a damaged return still owes a resolution */}
          {row.condition_on_return === "DAMAGED" ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-25 px-3 py-2 text-sm font-medium text-warning-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                This book was returned as DAMAGED — replacement/payment pending.
              </span>
            </div>
          ) : null}

          {/* Live ₱ owed — UNPAID warns in error red, PAID confirms in green */}
          {fine && fine.status === "UNPAID" ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-error-500/30 bg-error-25 px-3 py-2 text-sm font-medium text-error-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {`Overdue fine: ${formatPeso(fine.amount_centavos)} (${
                  fine.days_late ?? row.days_late ?? 0
                } ${(fine.days_late ?? row.days_late ?? 0) === 1 ? "day" : "days"}) — settle at the library`}
              </span>
            </div>
          ) : fine && fine.status === "PAID" ? (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-success-500/30 bg-success-25 px-3 py-2 text-sm font-medium text-success-700">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {`Overdue fine: ${formatPeso(fine.amount_centavos)} — Paid`}
              </span>
            </div>
          ) : fine ? (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {`Overdue fine: ${formatPeso(fine.amount_centavos)} — Waived`}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
