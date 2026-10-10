-- =============================================================================
-- 0009_student_return_requests.sql — student-initiated return requests
-- Feature: the student "Return book" button (early returns, FR-16 extension).
-- A student taps "Return book" on an active loan; the desk confirms receipt
-- with the existing return flow (record_return + condition check). This flag
-- only signals intent — it never closes the loan, flips the copy, or waives
-- fines (custody and condition stay with the librarian, R-14/R-18/R-21).
-- Idempotent: safe to re-run (same contract as 0001–0008).
-- =============================================================================

alter table public.loans
  add column if not exists return_requested_at timestamptz;

-- -----------------------------------------------------------------------------
-- request_loan_return — the only way a student write touches `loans`.
-- SECURITY DEFINER (mirrors release_loan / record_return in 0002): ownership
-- and state are re-verified in SQL, so a direct REST call can never set
-- returned_at / condition_on_return — only this flag.
-- Returns the (first) request timestamp; repeat taps are idempotent.
-- -----------------------------------------------------------------------------
create or replace function public.request_loan_return(p_loan_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans%rowtype;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if not found then
    raise exception 'Loan not found.';
  end if;
  if v_loan.student_id <> auth.uid() then
    raise exception 'Not your loan.';              -- §9 matrix: own only
  end if;
  if v_loan.returned_at is not null then
    raise exception 'Already returned.';           -- E6: returned loses cleanly
  end if;
  if v_loan.status not in ('ACTIVE', 'OVERDUE') then
    raise exception 'Loan is not active.';
  end if;

  update public.loans
     set return_requested_at = coalesce(return_requested_at, now())
   where id = p_loan_id
  returning return_requested_at into v_loan.return_requested_at;

  return v_loan.return_requested_at;
end;
$$;

revoke execute on function public.request_loan_return(uuid) from public, anon;
grant execute on function public.request_loan_return(uuid) to authenticated;
