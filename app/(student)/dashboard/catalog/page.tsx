import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BookOpen, CircleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { CatalogCard } from "@/components/student/catalog-card";
import { CatalogToolbar } from "@/components/student/catalog-toolbar";
import { StudentPagination } from "@/components/student/pagination";
import {
  CATALOG_PER_PAGE,
  buildCatalogPath,
  parseCatalogQuery,
} from "@/components/student/catalog-query";
import {
  getBooksWithAvailability,
  getDistinctCategories,
  type CatalogPage,
} from "@/lib/catalog/availability";
import { getBlockingNotices } from "@/lib/catalog/fines-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Browse Books" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  q?: string | string[];
  category?: string | string[];
  page?: string | string[];
}>;

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedCatalog {
  catalog: CatalogPage;
  categories: string[];
  /** Book ids with a PENDING request by this student (R-10 — one query). */
  pendingBookIds: Set<string>;
  /** Computed unpaid balance (R-27); null when the read failed (best-effort). */
  hasBalance: boolean;
  /** R-25 blocking banners — unpaid OVERDUE / DAMAGE notices (Phase 5). */
  notices: string[];
}

/**
 * Student → Browse Books (US-2, US-7, design §6 — the prime student screen).
 *
 * Server component reading `searchParams` (q, category, page). Renders for
 * any signed-in profile (admins may preview via "Switch dashboard"), but the
 * Request buttons only *do* anything for students — `submitBookRequest`
 * re-verifies the role and R-09/R-25 eligibility server-side (R-31).
 *
 * Per-card eligibility is deliberately **not** computed (7 reads × 20 cards);
 * instead the page batches:
 *   - the viewer's PENDING request `book_id`s → "Requested ✓" disabled state,
 *   - `student_balances` → the unpaid-balance banner + disabled buttons,
 *   - live `available_copies` from `getBooksWithAvailability` → "No copies".
 */
export default async function StudentCatalogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { q, category, page } = parseCatalogQuery(await searchParams);
  const filtering = q.length > 0 || category.length > 0;

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: LoadedCatalog | null = null;
  try {
    const supabase = await createClient();
    const [catalog, categories, pendingRes, balanceRes] = await Promise.all([
      getBooksWithAvailability({
        query: q || undefined,
        category: category || undefined,
        page,
        perPage: CATALOG_PER_PAGE,
      }),
      getDistinctCategories(),
      // R-10 / US-2 — one query feeds every card's "Requested" state.
      supabase
        .from("loan_requests")
        .select("book_id")
        .eq("student_id", me.id)
        .eq("status", "PENDING"),
      // R-27 — balance is computed, never cached. Best-effort: if this read
      // fails the banner is skipped, while `submitBookRequest` still enforces
      // R-25 server-side and toasts the exact block message.
      supabase
        .from("student_balances")
        .select("balance_centavos, unpaid_count")
        .eq("student_id", me.id)
        .maybeSingle(),
    ]);
    if (pendingRes.error) throw new Error(pendingRes.error.message);

    const pendingBookIds = new Set(
      (pendingRes.data ?? []).map((row) => (row as { book_id: string }).book_id),
    );
    const balance =
      balanceRes.error || !balanceRes.data
        ? null
        : (balanceRes.data as { balance_centavos: number; unpaid_count: number });

    // R-25 blocking banners (Phase 5): best-effort — the hard block still
    // applies server-side in getRequestEligibility (R-31) even if this read
    // fails, and `hasBalance` above already drives the disabled buttons.
    let notices: string[] = [];
    try {
      notices = await getBlockingNotices(me.id);
    } catch {
      notices = [];
    }

    data = {
      catalog,
      categories,
      pendingBookIds,
      hasBalance: balance
        ? balance.unpaid_count > 0 || balance.balance_centavos > 0
        : false,
      notices,
    };
  } catch {
    data = null; // surface a readable error instead of an empty catalog
  }

  const rows = data?.catalog.rows ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil(
      (data?.catalog.total ?? 0) / (data?.catalog.perPage ?? CATALOG_PER_PAGE),
    ),
  );
  const onCurrentPage = page > pageCount;

  return (
    <AppShell
      title="Browse Books"
      subtitle="Find a title and send a borrow request — the library approves at the desk."
      navVariant="student"
      user={{ name: me.full_name, id: me.student_id ?? me.role }}
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        {/* R-25 / US-7 — unpaid balance inline alerts (design §4.7):
            one line per fine type, straight from getBlockingNotices() */}
        {data && data.notices.length > 0 ? (
          <div role="status" className="flex flex-col gap-2">
            {data.notices.map((notice) => (
              <div
                key={notice}
                className="flex items-start gap-3 rounded-lg border border-error-500/30 bg-error-25 px-4 py-3"
              >
                <CircleAlert
                  className="mt-0.5 size-5 shrink-0 text-error-500"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-error-700">{notice}</p>
              </div>
            ))}
          </div>
        ) : null}

        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load the catalog.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Search + category pills (design §6 — same UX as admin books) */}
            <CatalogToolbar
              q={q}
              category={category}
              categories={data.categories}
            />

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <BookOpen className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-base font-semibold text-gray-900">
                  {onCurrentPage
                    ? "Nothing on this page."
                    : filtering
                      ? "No books match your search."
                      : "No books in the catalog yet."}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  {onCurrentPage
                    ? "Return to the first page to see the remaining books."
                    : filtering
                      ? "Try a different title or author — or pick another category."
                      : "Ask the library to add titles — new books appear here as soon as they are stocked."}
                </p>
                <Button
                  variant="secondary"
                  size="md"
                  href={
                    onCurrentPage
                      ? buildCatalogPath({ q, category, page: 1 })
                      : buildCatalogPath({})
                  }
                  className="mt-4"
                >
                  {onCurrentPage ? "Back to first page" : "Clear filters"}
                </Button>
              </div>
            ) : (
              <>
                {/* Cover-card grid — design §6: 2 cols → 3 md → 4 lg → 5 xl */}
                <ul
                  aria-label="Books in the catalog"
                  className="grid list-none grid-cols-2 gap-6 p-0 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                >
                  {rows.map((book) => (
                    <li key={book.id} className="min-w-0">
                      <CatalogCard
                        book={book}
                        alreadyRequested={data.pendingBookIds.has(book.id)}
                        hasBalance={data.hasBalance}
                      />
                    </li>
                  ))}
                </ul>

                {pageCount > 1 ? (
                  <StudentPagination
                    basePath="/dashboard/catalog"
                    query={{
                      ...(q ? { q } : {}),
                      ...(category ? { category } : {}),
                    }}
                    page={page}
                    pageCount={pageCount}
                    label="Catalog pagination"
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
