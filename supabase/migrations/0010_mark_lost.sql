-- =============================================================================
-- 0010_mark_lost.sql — "Mark lost" loans (user request, FR-18 extension)
-- Scenario: a student loses a book — it never comes back, so the damage
-- workflow (which needs a RETURNED+DAMAGED loan) can never charge them.
-- `mark_loan_lost()` closes the loan out of circulation, flags the copy LOST
-- and creates a LOST fine at the book's replacement value (R-08 basis), which
-- then flows through the existing Penalties pay/waive pipeline.
-- Idempotent: safe to re-run (same contract as 0001–0009).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. fines.type gains 'LOST' (finds the live check constraint by definition —
--    inline column checks get auto-generated names we cannot guess).
-- -----------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.fines'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%OVERDUE%'
  loop
    execute format('alter table public.fines drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.fines
  add constraint fines_type_check
  check (type in ('OVERDUE', 'DAMAGE', 'LOST'));

-- -----------------------------------------------------------------------------
-- 2. loans.condition_on_return gains 'LOST' — a lost book is "returned" in the
--    accounting sense (left the student's custody permanently at the mark-lost
--    moment) with condition LOST. `returned_needs_condition` keeps holding
--    (condition stays NOT NULL); the desk flow is unaffected because
--    record_return() still validates GOOD/DAMAGED in SQL before writing.
-- -----------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.loans'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%GOOD%'
  loop
    execute format('alter table public.loans drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.loans
  add constraint loans_condition_on_return_check
  check (condition_on_return is null
         or condition_on_return in ('GOOD', 'DAMAGED', 'LOST'));

-- -----------------------------------------------------------------------------
-- 3. mark_loan_lost — ADMIN-only (is_admin() gate, same as release_loan /
--    record_return in 0002). Atomic: lock the loan, verify it is still open,
--    close it as RETURNED/LOST, flag the copy LOST, charge the replacement
--    value (never computed in TS, R-14/R-29), audit (R-32). One LOST fine per
--    loan is enforced by the existing uq_fine_per_loan index + the
--    already-returned guard above the insert.
-- -----------------------------------------------------------------------------
create or replace function public.mark_loan_lost(p_loan_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_loan     public.loans%rowtype;
  v_value    int;
  v_title    text;
  v_profile  uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin only';                       -- §9 matrix / R-31
  end if;

  select * into v_loan
    from public.loans
   where id = p_loan_id
     for update;
  if not found then
    raise exception 'Loan not found.';
  end if;
  if v_loan.returned_at is not null then
    raise exception 'Loan is already closed.';          -- E6: second admin loses
  end if;
  if v_loan.status not in ('ACTIVE', 'OVERDUE') then
    raise exception 'Loan is not active.';
  end if;

  -- R-08 / R-29: the charge basis is the book's replacement value, read here
  -- so the client can never set the amount.
  select b.replacement_value_centavos, b.title
    into v_value, v_title
    from public.books b
   where b.id = v_loan.book_id;
  if v_value is null or v_value <= 0 then
    raise exception 'Book has no replacement value set.';
  end if;

  -- Close the loan out of circulation (accounting return, condition LOST)
  update public.loans
     set returned_at        = now(),
         status             = 'RETURNED',
         condition_on_return = 'LOST',
         returned_to        = v_profile
   where id = p_loan_id;

  -- The physical copy is gone (R-07: LOST stays out of circulation)
  update public.book_copies
     set status = 'LOST'
   where id = v_loan.copy_id;

  -- The penalty itself — a LOST fine at full replacement value (R-08/R-29).
  insert into public.fines (student_id, loan_id, type, amount_centavos,
                            description)
  values (v_loan.student_id, p_loan_id, 'LOST', v_value,
          format('Replacement — %s (marked lost)', v_title));

  -- R-32: audit trail
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_profile, 'MARK_LOST', 'loan', p_loan_id,
          jsonb_build_object('copy_status', 'LOST',
                             'fine_centavos', v_value,
                             'book_title', v_title));

  return p_loan_id;
end $$;

revoke execute on function public.mark_loan_lost(uuid) from public, anon;
grant execute on function public.mark_loan_lost(uuid) to authenticated;
