/**
 * Shared auth/account types.
 *
 * Deliberately free of `server-only` / "use server" markers so both client
 * components (form state, table rows) and server code can import the types.
 * The runtime helpers below are plain data guards — no secrets, no I/O.
 */

export type Role = "ADMIN" | "STUDENT";

export type AccountStatus = "ACTIVE" | "BLOCKED";

/** One row of `public.profiles` (schema.md §2.1). */
export interface ProfileRow {
  id: string;
  role: Role;
  student_id: string | null;
  full_name: string;
  course_section: string | null;
  phone: string | null;
  status: AccountStatus;
  created_by: string | null;
  created_at: string | null;
}

/**
 * Result shape returned by every account-management server action.
 * `fieldErrors` is keyed by form field name (mirrors Zod paths).
 */
export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Narrow an untyped Postgrest row to {@link ProfileRow}.
 * Unknown/extra columns are ignored; malformed rows return null.
 */
export function parseProfileRow(value: unknown): ProfileRow | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || typeof record.full_name !== "string") {
    return null;
  }
  if (record.role !== "ADMIN" && record.role !== "STUDENT") return null;

  return {
    id: record.id,
    role: record.role,
    student_id: asString(record.student_id),
    full_name: record.full_name,
    course_section: asString(record.course_section),
    phone: asString(record.phone),
    status: record.status === "BLOCKED" ? "BLOCKED" : "ACTIVE",
    created_by: asString(record.created_by),
    created_at: asString(record.created_at),
  };
}

/** Narrow an untyped Postgrest result set to {@link ProfileRow}s. */
export function parseProfileRows(value: unknown): ProfileRow[] {
  if (!Array.isArray(value)) return [];
  const rows: ProfileRow[] = [];
  for (const item of value) {
    const row = parseProfileRow(item);
    if (row) rows.push(row);
  }
  return rows;
}
