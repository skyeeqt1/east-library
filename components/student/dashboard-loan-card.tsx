import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CountdownChip,
  countdownFor,
  withOwedAmount,
} from "@/components/student/countdown-chip";
import type { StudentLoanRow } from "@/lib/catalog/loans-read";

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
 * One open loan on the student dashboard — the design §6 mock's
 * "My active loans" row:
 *
 *   📖 The Great Gatsby          ⏱ 3 days left
 *   Due Oct 14, 2026             [View details]
 *
 * Countdown colours come from the shared `countdown-chip` rule (green >3d ·
 * orange 1–3d · red due-today/overdue with the live ₱ owed when a fine is
 * already recorded). Server component — plain row data, no client code.
 */
export function DashboardLoanCard({ row }: { row: StudentLoanRow }) {
  const countdown = withOwedAmount(countdownFor(row), row.fine);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-semibold text-primary-700"
          >
            {initialsOf(row.title)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">
              {row.title}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Due {formatDate(row.due_date)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {countdown ? <CountdownChip countdown={countdown} /> : null}
          <Button size="sm" variant="secondary" href="/dashboard/loans">
            View details
          </Button>
        </div>
      </div>
    </Card>
  );
}
