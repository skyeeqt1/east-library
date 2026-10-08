-- =============================================================================
-- 0006_student_balances_security_invoker.sql — close RLS bypass on the view
--
-- Security finding from Phase 3b render tests: public.student_balances was
-- created WITHOUT security_invoker = true, so it ran as its owner (postgres)
-- and BYPASSED row level security — an unauthenticated anon-key request could
-- read any student's balance (proven live). Same class of issue applies to
-- book_availability (see fix below): book data is not student-sensitive, but
-- making it security_invoker too keeps the security model uniform — policies
-- on the underlying tables (admin full read / student select) govern both.
--
-- Fix: recreate both views with security_invoker = true so they execute with
-- the CALLER's RLS permissions. After this:
--   - student_balances: a student sees their own balance (fines RLS = own rows;
--     profiles RLS = own row) — other students aggregate away to 0 rows.
--   - book_availability: students keep read access via the books/book_copies
--     SELECT policies (catalog must stay visible to logged-in students).
-- =============================================================================

drop view if exists public.student_balances;
create view public.student_balances
with (security_invoker = true) as
select p.id as student_id,
       coalesce(sum(f.amount_centavos) filter (where f.status = 'UNPAID'), 0) as balance_centavos,
       count(f.id) filter (where f.status = 'UNPAID') as unpaid_count
from public.profiles p
left join public.fines f on f.student_id = p.id
group by p.id;

drop view if exists public.book_availability;
create view public.book_availability
with (security_invoker = true) as
select b.id as book_id,
       count(*) as total_copies,
       count(*) filter (where c.status = 'AVAILABLE') as available_copies
from public.books b
left join public.book_copies c on c.book_id = b.id
group by b.id;

comment on view public.student_balances is
  'Per-student unpaid balance. security_invoker=true so RLS on profiles/fines applies (fixes anon bypass, migration 0006).';
comment on view public.book_availability is
  'Per-book copy counts. security_invoker=true — RLS on books/book_copies applies.';
