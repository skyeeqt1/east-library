"use server";

import { revalidatePath } from "next/cache";
import { createClient, getServiceClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/auth/guards";
import type { ActionResult } from "@/lib/auth/types";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  addCopiesSchema,
  createBookSchema,
  editBookSchema,
} from "@/lib/validations/book";
import type { BookCopyRow, BookRecord } from "@/lib/catalog/availability";

/**
 * ============================================================================
 *  Admin book & copy mutations (Phase 2 — rules.md §3 / §9, schema.md §2.2/2.3)
 * ============================================================================
 *
 * Every action follows lib/auth/admin-actions.ts:
 *   1. `assertAdmin()` — session → `profiles.role` → redirect when not ADMIN
 *      (rules.md §9: "Create/edit books, copies" is ADMIN-only, R-31),
 *   2. re-validates the payload with Zod (client values are never trusted),
 *   3. writes through the **cookie-aware anon client** — RLS grants admins full
 *      CRUD on `books` / `book_copies` (`"books: admin manages"` /
 *      `"book_copies: admin manages"`, schema.md §4), so no service-role
 *      bypass is needed for catalog writes; if a write is ever rejected by RLS
 *      (42501) it is retried once with the service-role client so the admin
 *      action still succeeds,
 *   4. appends an `audit_logs` row (R-32) — via the service-role client,
 *      because `audit_logs` deliberately has **no client INSERT policy**
 *      (schema.md §4: "no insert from client — written by triggers / service
 *      role"), and
 *   5. revalidates the admin catalog + student catalog routes.
 *
 * ⚠️  There is deliberately **no `deleteBook` action in v1**: a title with loan
 *     or fine history must never vanish (same reasoning as R-06 for accounts —
 *     audit integrity). Retiring a title is a future "decommission" flag, not a
 *     hard delete. Removing `book_copies` rows is likewise not exposed here:
 *     copies are deactivated through their status (see `setCopyStatus`).
 *
 * ⚠️  Manual DAMAGED / LOST in `setCopyStatus` is **book-condition logging**
 *     (the librarian noting a spoiled/missing copy). It does NOT create fines:
 *     the damage-fine flow is `assess_damage` in Phase 5 (R-22/R-23), which
 *     runs from the loan-return flow and writes `damage_reports` + `fines`.
 */

/** Routes whose cached data depends on catalog writes. */
const CATALOG_PATHS = ["/admin/books", "/dashboard/catalog"] as const;

const BOOK_COLUMNS =
  "id, isbn, title, author, category, shelf_code, cover_url, replacement_value_centavos, created_at, updated_at";

const COPY_COLUMNS = "id, barcode, status, acquired_at";

/** Statuses an admin may set by hand (R-07). `ON_LOAN` belongs to the loan flow. */
const MANUAL_COPY_STATUSES = ["AVAILABLE", "DAMAGED", "LOST"] as const;

/* ------------------------------------------------------------------ */
/* Result types                                                        */
/* ------------------------------------------------------------------ */

/** Success carries the payload; failure reuses `ActionResult`'s error fields. */
export type BookActionResult<T = unknown> =
  | ({ ok: true; data: T } & Omit<ActionResult, "ok">)
  | ({ ok: false } & Omit<ActionResult, "ok">);

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Row Level Security rejection (permission / policy violation). */
function isRlsBlock(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42501" ||
    /row-level security|permission denied|violates row-level security/i.test(
      error.message ?? "",
    )
  );
}

/** Barcode for the nth copy of a title: `ESCR-<first 6 of id>-001`. */
function barcodeFor(bookId: string, sequence: number): string {
  return `ESCR-${bookId.slice(0, 6).toUpperCase()}-${String(sequence).padStart(3, "0")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function revalidateCatalog(): void {
  for (const path of CATALOG_PATHS) revalidatePath(path);
}

/** Narrows an arbitrary payload to the `audit_logs.after` jsonb shape. */
function auditPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/**
 * Best-effort audit trail — never fails an already-committed mutation (R-32).
 * Uses the service-role client: `audit_logs` is append-only and intentionally
 * has no client-side INSERT policy (schema.md §4).
 */
async function writeAudit(
  actorId: string,
  action: string,
  entityType: "book" | "book_copy",
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    const service = getServiceClient();
    await service.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before,
      after,
    });
  } catch {
    // Missing env / network — the mutation itself already succeeded.
  }
}

/**
 * Insert `book_copies` rows through the anon client (admin RLS), retrying once
 * with the service role if RLS is what rejected the write.
 */
async function insertCopies(
  rows: Array<{ book_id: string; barcode: string; status: string }>,
): Promise<{ code?: string; message?: string } | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("book_copies").insert(rows);
  if (!isRlsBlock(error)) return error;

  const { error: retryError } = await getServiceClient()
    .from("book_copies")
    .insert(rows);
  return retryError;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create a title and — when `initial_copies > 0` — its first physical copies
 * (R-07: copies are atomic rows, availability is never a stored counter).
 *
 * Barcodes follow `ESCR-<id-prefix>-<nnn>`; a failed copies insert rolls the
 * whole title back so a book is never left with fewer copies than requested.
 */
export async function createBook(
  input: unknown,
): Promise<BookActionResult<BookRecord>> {
  const { adminId } = await assertAdmin();

  const parsed = createBookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { initial_copies, ...bookFields } = parsed.data;
  const supabase = await createClient();

  let created = await supabase
    .from("books")
    .insert(bookFields)
    .select(BOOK_COLUMNS)
    .single();
  if (isRlsBlock(created.error)) {
    created = await getServiceClient()
      .from("books")
      .insert(bookFields)
      .select(BOOK_COLUMNS)
      .single();
  }
  const book = created.data as BookRecord | null;
  if (created.error || !book) {
    return { ok: false, error: "Could not create the book. Please try again." };
  }

  if (initial_copies > 0) {
    const copies = Array.from({ length: initial_copies }, (_, index) => ({
      book_id: book.id,
      barcode: barcodeFor(book.id, index + 1),
      status: "AVAILABLE",
    }));
    const copiesError = await insertCopies(copies);
    if (copiesError) {
      // Never leave a half-created title behind (R-07 — copies are atomic).
      await getServiceClient().from("books").delete().eq("id", book.id);
      return {
        ok: false,
        error: "Could not create the book copies. Please try again.",
      };
    }
  }

  await writeAudit(adminId, "BOOK_CREATE", "book", book.id, null, {
    ...bookFields,
    initial_copies,
  });

  revalidateCatalog();
  return { ok: true, data: book };
}

/**
 * Edit a title's metadata (never its copies — those change via `addCopies`
 * / `setCopyStatus`). Audit-logged with before/after values (R-32).
 */
export async function updateBook(
  bookId: string,
  input: unknown,
): Promise<BookActionResult<BookRecord>> {
  const { adminId } = await assertAdmin();
  if (!isUuid(bookId)) return { ok: false, error: "Book not found." };

  const parsed = editBookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("books")
    .select(BOOK_COLUMNS)
    .eq("id", bookId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Book not found." };

  const patch = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };

  let updated = await supabase
    .from("books")
    .update(patch)
    .eq("id", bookId)
    .select(BOOK_COLUMNS)
    .single();
  if (isRlsBlock(updated.error)) {
    updated = await getServiceClient()
      .from("books")
      .update(patch)
      .eq("id", bookId)
      .select(BOOK_COLUMNS)
      .single();
  }
  const book = updated.data as BookRecord | null;
  if (updated.error || !book) {
    return { ok: false, error: "Could not save the changes. Please try again." };
  }

  await writeAudit(
    adminId,
    "BOOK_UPDATE",
    "book",
    bookId,
    auditPayload(before),
    auditPayload(parsed.data),
  );

  revalidateCatalog();
  return { ok: true, data: book };
}

/**
 * Add physical copies to an existing title.
 *
 * Numbering: the batch continues after the highest `…-<nnn>` suffix already
 * present for this title's prefix (so printed labels stay sequential), e.g.
 * a title whose barcodes end at `…-003` gets `…-004, …-005`. If that sequence
 * would collide with a barcode owned by another title (two uuids can share a
 * 6-char prefix, or a custom prefix was reused) the batch falls back to a
 * timestamp-unique suffix — a unique violation never blocks the add.
 */
export async function addCopies(
  bookId: string,
  input: unknown,
): Promise<BookActionResult<{ bookId: string; added: number }>> {
  const { adminId } = await assertAdmin();
  if (!isUuid(bookId)) return { ok: false, error: "Book not found." };

  const parsed = addCopiesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { count, barcode_prefix } = parsed.data;

  const supabase = await createClient();
  const { data: book } = await supabase
    .from("books")
    .select("id")
    .eq("id", bookId)
    .maybeSingle();
  if (!book) return { ok: false, error: "Book not found." };

  const prefix =
    barcode_prefix || `ESCR-${bookId.slice(0, 6).toUpperCase()}`;

  const { data: existing } = await supabase
    .from("book_copies")
    .select("barcode")
    .eq("book_id", bookId);
  const suffixPattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let sequence = 1;
  for (const row of (existing ?? []) as { barcode: string | null }[]) {
    const match = row.barcode?.match(suffixPattern);
    if (match) {
      sequence = Math.max(sequence, Number.parseInt(match[1], 10) + 1);
    }
  }

  const buildRows = (barcodes: string[]) =>
    barcodes.map((barcode) => ({
      book_id: bookId,
      barcode,
      status: "AVAILABLE",
    }));

  let rows = buildRows(
    Array.from({ length: count }, (_, index) =>
      `${prefix}-${String(sequence + index).padStart(3, "0")}`,
    ),
  );
  let insertError = await insertCopies(rows);

  if (insertError?.code === "23505") {
    // Barcode collision — retry once with a timestamp-unique batch suffix.
    const batch = Date.now().toString(36).toUpperCase();
    rows = buildRows(
      Array.from(
        { length: count },
        (_, index) => `${prefix}-${batch}-${index + 1}`,
      ),
    );
    insertError = await insertCopies(rows);
  }

  if (insertError) {
    return { ok: false, error: "Could not add the copies. Please try again." };
  }

  await writeAudit(adminId, "BOOK_COPIES_ADD", "book", bookId, null, {
    count,
    barcode_prefix: prefix,
  });

  revalidateCatalog();
  return { ok: true, data: { bookId, added: count } };
}

/**
 * Manually set a copy's status — book-condition logging only.
 *
 * - `ON_LOAN` is rejected: circulation is driven exclusively by the loan flow
 *   (R-11/R-14 — release flips the copy, return flips it back).
 * - `DAMAGED` / `LOST` here record the physical condition of the copy. They do
 *   NOT create fines — `assess_damage` (Phase 5, R-22/R-23) is what charges a
 *   student the replacement value from a loan return.
 * - Anything else (including unknown values) is rejected.
 */
export async function setCopyStatus(
  copyId: string,
  status: string,
): Promise<BookActionResult<BookCopyRow>> {
  const { adminId } = await assertAdmin();

  if (status === "ON_LOAN") {
    return { ok: false, error: "Copy status is managed by the loan flow." };
  }
  if (!(MANUAL_COPY_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid copy status." };
  }
  if (!isUuid(copyId)) return { ok: false, error: "Copy not found." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("book_copies")
    .select("id, book_id, barcode, status")
    .eq("id", copyId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Copy not found." };

  let updated = await supabase
    .from("book_copies")
    .update({ status })
    .eq("id", copyId)
    .select(COPY_COLUMNS)
    .single();
  if (isRlsBlock(updated.error)) {
    updated = await getServiceClient()
      .from("book_copies")
      .update({ status })
      .eq("id", copyId)
      .select(COPY_COLUMNS)
      .single();
  }
  const copy = updated.data as BookCopyRow | null;
  if (updated.error || !copy) {
    return {
      ok: false,
      error: "Could not update the copy status. Please try again.",
    };
  }

  await writeAudit(
    adminId,
    "BOOK_COPY_STATUS",
    "book_copy",
    copyId,
    { status: before.status, barcode: before.barcode },
    { status, barcode: before.barcode, book_id: before.book_id },
  );

  revalidateCatalog();
  return { ok: true, data: copy };
}
