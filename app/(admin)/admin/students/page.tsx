import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { UserPlus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PrimaryCell,
  Table,
  TableBody,
  Td,
  TdCheckbox,
  Th,
  ThCheckbox,
  TableHead,
  Tr,
} from "@/components/ui/table";
import { CreateAccountButton } from "@/components/admin/students/create-account-button";
import { StudentRowActions } from "@/components/admin/students/student-row-actions";
import { StudentsPagination } from "@/components/admin/students/students-pagination";
import { StudentsToolbar } from "@/components/admin/students/students-toolbar";
import {
  STUDENTS_PER_PAGE,
  parseStudentsQuery,
} from "@/components/admin/students/students-query";
import { getCurrentProfile } from "@/lib/auth/guards";
import { parseProfileRows, type ProfileRow } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Students" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  q?: string | string[];
  status?: string | string[];
  page?: string | string[];
}>;

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatJoined(row: ProfileRow): string {
  if (!row.created_at) return "—";
  const parsed = new Date(row.created_at);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/** Strip characters that would break PostgREST's `.or()` filter syntax. */
function sanitizeSearchTerm(value: string): string {
  return value.replace(/[(),%]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Admin → Students (FR-04 / FR-05, R-01…R-04).
 *
 * Server component: reads `searchParams` (search, status filter, page),
 * queries `profiles` through the **cookie-aware anon client** — RLS gives an
 * admin a full read, a student none (defense in depth with the layout guard).
 * All mutations happen in `lib/auth/admin-actions.ts` server actions.
 */
export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session work: supabase-js reads token
  // expiry via Date.now(), which Next flags as an unstable value in a
  // static-prerender pass (dev "1 Issue" badge).
  await connection();
  const { q, status, page } = parseStudentsQuery(await searchParams);
  const term = sanitizeSearchTerm(q);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  const supabase = await createClient();

  const buildQuery = (
    statusFilter?: "ACTIVE" | "BLOCKED",
    head = false,
  ) => {
    let query = supabase
      .from("profiles")
      .select(head ? "id" : "*", { count: "exact", head })
      .eq("role", "STUDENT");
    if (term) {
      query = query.or(
        `student_id.ilike.%${term}%,full_name.ilike.%${term}%,course_section.ilike.%${term}%`,
      );
    }
    if (statusFilter) query = query.eq("status", statusFilter);
    return query;
  };

  const offset = (page - 1) * STUDENTS_PER_PAGE;

  const [allRes, activeRes, blockedRes, pageRes] = await Promise.all([
    buildQuery(undefined, true),
    buildQuery("ACTIVE", true),
    buildQuery("BLOCKED", true),
    buildQuery(status === "ALL" ? undefined : status)
      .order("created_at", { ascending: false })
      .range(offset, offset + STUDENTS_PER_PAGE - 1),
  ]);

  const rows = parseProfileRows(pageRes.data);
  const queryError = pageRes.error;
  const total = queryError ? 0 : (pageRes.count ?? rows.length);
  const pageCount = Math.max(1, Math.ceil(total / STUDENTS_PER_PAGE));

  const counts = {
    all: allRes.count ?? 0,
    active: activeRes.count ?? 0,
    blocked: blockedRes.count ?? 0,
  };

  const filtering = term.length > 0 || status !== "ALL";

  return (
    <AppShell
      title="Students"
      subtitle="Create, edit, block and reset student accounts — no self-registration (R-01)."
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
      actions={<CreateAccountButton />}
    >
      <div className="flex flex-col gap-6">
        <StudentsToolbar q={q} status={status} counts={counts} />

        {queryError ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load student accounts.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
            <span
              className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
              aria-hidden="true"
            >
              <UserPlus className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-base font-semibold text-gray-900">
              {total > 0
                ? "Nothing on this page."
                : filtering
                  ? "No students match your search."
                  : "No student accounts yet — create the first one."}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              {total > 0
                ? "Return to the first page to see the remaining accounts."
                : filtering
                  ? "Try a different name, Student ID or course — or clear the filters."
                  : "Accounts are created here and issued to students in person."}
            </p>
            {(total > 0 || filtering) && (
              <Button
                variant="secondary"
                size="md"
                href="/admin/students"
                className="mt-4"
              >
                {total > 0 ? "Back to first page" : "Clear filters"}
              </Button>
            )}
          </div>
        ) : (
          <Table
            minWidth={860}
            footer={
              <StudentsPagination
                page={page}
                pageCount={pageCount}
                q={q}
                status={status}
              />
            }
          >
            <TableHead>
              <ThCheckbox>
                <span className="sr-only">Select</span>
              </ThCheckbox>
              <Th>Student ID</Th>
              <Th>Name</Th>
              <Th>Course</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th className="text-right">Actions</Th>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <TdCheckbox>
                    <input
                      type="checkbox"
                      disabled
                      title="Bulk actions arrive in a later phase"
                      aria-label={`Select ${row.full_name} (unavailable)`}
                      className="size-4 rounded border-gray-300 accent-primary-500 disabled:opacity-50"
                    />
                  </TdCheckbox>
                  <Td className="font-mono text-xs font-medium text-gray-900">
                    {row.student_id ?? "—"}
                  </Td>
                  <Td>
                    <PrimaryCell
                      primary={row.full_name}
                      secondary={row.phone ?? undefined}
                    />
                  </Td>
                  <Td>{row.course_section ?? "—"}</Td>
                  <Td>
                    {/* design §2.1 map: ACTIVE = success · BLOCKED = error */}
                    <Badge
                      tone={row.status === "BLOCKED" ? "error" : "success"}
                    >
                      {row.status === "BLOCKED" ? "Blocked" : "Active"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {formatJoined(row)}
                  </Td>
                  <Td>
                    <StudentRowActions
                      student={{
                        id: row.id,
                        fullName: row.full_name,
                        courseSection: row.course_section ?? "",
                        phone: row.phone,
                        status: row.status,
                      }}
                    />
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AppShell>
  );
}
