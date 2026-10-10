import { CircleCheck, Receipt, TriangleAlert } from "lucide-react";
import { Badge, toneForStatus, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { StudentFineRow } from "@/lib/catalog/fines-read";
import { cn, formatPeso } from "@/lib/utils";
import type { FineStatus, FineType } from "@/lib/validations/fine";

/**
 * Friendly label + tone per `fines.type` (design §2.1: OVERDUE/LOST = error
 * chip, DAMAGE = warning chip — deliberately distinct so a student can tell
 * at a glance *why* a charge exists).
 */
const TYPE_META: Record<FineType, { label: string; tone: BadgeTone }> = {
  OVERDUE: { label: "Overdue", tone: "error" },
  DAMAGE: { label: "Damage", tone: "warning" },
  LOST: { label: "Lost book", tone: "error" },
};

const STATUS_LABELS: Record<FineStatus, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  WAIVED: "Waived",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/** `paid_method` → the student-facing settlement wording (R-28). */
const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash received at the desk",
  REPLACEMENT: "Book replaced",
};

/**
 * One fine as a statement row (design §6 — statement-style list: **type ·
 * book · days · amount ₱ · status · payment instructions**).
 *
 * Server component: pure row data, no client interactivity — only the tab
 * pills and pager elsewhere on the page are client code. The amount is
 * always `formatPeso(centavos)` (R-29) and never editable anywhere in the
 * student UI (R-31: settlements happen at the desk).
 */
export function FineCard({ row }: { row: StudentFineRow }) {
  const type = TYPE_META[row.type];
  const unpaid = row.status === "UNPAID";

  /* One-line explanation under the title: days late (OVERDUE) or the
     librarian's damage description (DAMAGE). */
  const detail =
    row.type === "OVERDUE" && row.days_late !== null
      ? `${row.days_late} ${row.days_late === 1 ? "day" : "days"} late`
      : row.description;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0 flex-1">
          {/* Type chip + status badge (design §2.1 status → color map) */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={type.tone}>{type.label}</Badge>
            <Badge tone={toneForStatus(row.status)}>
              {STATUS_LABELS[row.status]}
            </Badge>
          </div>

          <p className="mt-2 truncate text-sm font-semibold text-gray-900">
            {row.book_title ?? "Library fine"}
          </p>
          {row.book_author ? (
            <p className="truncate text-xs text-gray-500">{row.book_author}</p>
          ) : null}

          <p className="mt-1 text-xs text-gray-500">
            {detail ? `${detail} · ` : ""}Charged {formatDate(row.created_at)}
          </p>
        </div>

        {/* Amount — the statement's headline figure (R-29 centavos → ₱) */}
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight",
            unpaid ? "text-error-700" : "text-gray-900",
          )}
        >
          {formatPeso(row.amount_centavos)}
        </p>
      </div>

      {/* Footer: how to pay (unpaid) or what happened (settled) */}
      {unpaid ? (
        <div className="flex items-start gap-2 border-t border-gray-100 bg-warning-25 px-5 py-3 text-sm font-medium text-warning-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Pay in cash at the library desk — the librarian records the payment
            and this clears immediately. Unpaid fines block new requests.
          </span>
        </div>
      ) : row.status === "PAID" ? (
        <div className="flex items-center gap-2 border-t border-gray-100 bg-success-25 px-5 py-3 text-sm font-medium text-success-700">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Paid {formatDate(row.paid_at)}
            {row.paid_method && METHOD_LABELS[row.paid_method]
              ? ` · ${METHOD_LABELS[row.paid_method]}`
              : ""}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3 text-sm font-medium text-gray-700">
          <Receipt className="size-4 shrink-0" aria-hidden="true" />
          <span>Waived — forgiven by the library.</span>
        </div>
      )}
    </Card>
  );
}
