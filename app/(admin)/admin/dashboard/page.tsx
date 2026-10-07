import type { Metadata } from "next";
import { Pencil, Eye } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import {
  PrimaryCell,
  Table,
  TableBody,
  TableFooter,
  Td,
  Th,
  ThCheckbox,
  TdCheckbox,
  TableHead,
  Tr,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Library Dashboard",
};

const DASHBOARD_TABS = [
  { id: "all", label: "All activity", count: 48 },
  { id: "pending", label: "Pending requests", count: 12 },
  { id: "overdue", label: "Overdue", count: 7 },
  { id: "returns", label: "Returns", count: 15 },
  { id: "fines", label: "Fines", count: 9 },
];

const TOTAL_BOOKS_TREND = [64, 68, 66, 72, 70, 76, 74, 80, 78, 84, 82, 88, 86, 92];
const ACTIVE_LOANS_TREND = [42, 48, 45, 52, 50, 58, 55, 62, 60, 66, 72, 68, 76, 82];
const OVERDUE_TREND = [30, 28, 32, 27, 25, 29, 24, 22, 26, 21, 19, 20, 17, 16];

interface ActivityRow {
  id: string;
  student: string;
  studentId: string;
  book: string;
  requested: string;
  due: string;
  status: string;
}

const ACTIVITY_ROWS: ActivityRow[] = [
  {
    id: "1",
    student: "Maria Santos",
    studentId: "2024-1056",
    book: "The Great Gatsby",
    requested: "Released Oct 1, 2026",
    due: "Oct 8, 2026",
    status: "Active",
  },
  {
    id: "2",
    student: "Juan Dela Cruz",
    studentId: "2024-0871",
    book: "Clean Code",
    requested: "Requested Oct 5, 2026",
    due: "—",
    status: "Pending",
  },
  {
    id: "3",
    student: "Angela Reyes",
    studentId: "2023-1120",
    book: "Atomic Habits",
    requested: "Released Sep 26, 2026",
    due: "Oct 3, 2026",
    status: "Overdue",
  },
  {
    id: "4",
    student: "Paolo Mendoza",
    studentId: "2024-0333",
    book: "Dune",
    requested: "Released Sep 23, 2026",
    due: "Sep 30, 2026",
    status: "Returned",
  },
];

/**
 * Admin dashboard — FR-21.
 *
 * Phase 6 replaces the dummy numbers with live data; this placeholder renders
 * the reference rhythm (header → tabs → 3 stat cards → borrow activity table)
 * so the layout can be eyeballed from Phase 0 onward.
 */
export default function AdminDashboardPage() {
  return (
    <AppShell
      title="Library Dashboard"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
      actions={
        <>
          <Button variant="secondary" size="md" href="/dashboard">
            Switch dashboard
          </Button>
          <Button size="md" disabled>
            Export report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Tab row (design §5.1) */}
        <Tabs tabs={DASHBOARD_TABS} activeId="all" aria-label="Activity filters" />

        {/* Three stat cards (design §5.2) */}
        <section aria-label="Key metrics" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Total books"
            value="1,284"
            delta={{ value: "1.2%", direction: "up" }}
            data={TOTAL_BOOKS_TREND}
          />
          <StatCard
            title="Active loans"
            value="128"
            delta={{ value: "2.4%", direction: "up" }}
            data={ACTIVE_LOANS_TREND}
          />
          <StatCard
            title="Overdue this week"
            value="17"
            delta={{ value: "0.8%", direction: "down" }}
            data={OVERDUE_TREND}
          />
        </section>

        {/* Borrow activity table (design §5.3) */}
        <section aria-labelledby="borrow-activity-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id="borrow-activity-heading" className="text-lg font-semibold text-gray-900">
              Borrow activity
            </h2>
            <p className="text-xs text-gray-500">
              <span className="font-medium text-gray-700">Phase 6</span> — live
              data, ⌘K search, filters and pagination land here.
            </p>
          </div>

          <Table
            minWidth={860}
            footer={<TableFooter page={1} pageCount={1} perPage={10} />}
          >
            <TableHead>
              <ThCheckbox>
                <span className="sr-only">Select</span>
              </ThCheckbox>
              <Th>Student</Th>
              <Th>Book</Th>
              <Th>Requested / Released</Th>
              <Th>Due date</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </TableHead>
            <TableBody>
              {ACTIVITY_ROWS.map((row) => (
                <Tr key={row.id}>
                  <TdCheckbox>
                    <input
                      type="checkbox"
                      aria-label={`Select row for ${row.student}`}
                      className="size-4 rounded border-gray-300 accent-primary-500"
                    />
                  </TdCheckbox>
                  <Td>
                    <PrimaryCell primary={row.student} secondary={row.studentId} />
                  </Td>
                  <Td className="font-medium text-gray-900">{row.book}</Td>
                  <Td>{row.requested}</Td>
                  <Td>{row.due}</Td>
                  <Td>
                    <StatusPill status={row.status} />
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`View ${row.book} loan`}
                        className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <Eye className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit ${row.book} loan`}
                        className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </AppShell>
  );
}
