-- =============================================================================
-- 0002_functions.sql — ESCR Library Management System — business logic functions
-- Source of truth: schema.md §7 (reference implementations),
--                  rules.md R-09…R-28 + E1/E6/E7, prd.md FR-09…FR-20, US-2…US-7
-- Platform: Supabase / PostgreSQL 15+ · money in integer centavos (R-29)
-- Every function is SECURITY DEFINER with `set search_path = public`, is
-- idempotent (`create or replace`) and cites the rule IDs it enforces (R-31:
-- due dates, fine amounts, availability and role checks are server-computed).
-- pg_cron scheduling of run_overdue_sweep() is intentionally out of scope here
-- (enabled separately, schema.md §7.2 / §8).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. release_loan — R-13 (availability re-check), R-14 (release creates the
--    loan), R-15/E6 (single decision, row lock), R-17 (7-day max loan),
--    R-32 (audit). Admin-only; atomic copy flip → loan → request link.
-- -----------------------------------------------------------------------------
create or replace function public.release_loan(p_request_id uuid, p_copy_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_loan     uuid;
  v_book_id  uuid;
  v_student  uuid;
  v_profile  uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin only';                       -- R-31 / §9 matrix
  end if;

  -- R-15 / E6: lock the request; only an APPROVED request may be released
  select book_id, student_id
    into v_book_id, v_student
    from public.loan_requests
   where id = p_request_id
     and status = 'APPROVED'
     for update;
  if not found then
    raise exception 'Request not found or not approved.';
  end if;

  -- R-07 / R-13: atomically hand over exactly one AVAILABLE copy of that book;
  -- if the copy is gone the whole release rolls back and the request stays put
  update public.book_copies
     set status = 'ON_LOAN'
   where id = p_copy_id
     and book_id = v_book_id
     and status = 'AVAILABLE';
  if not found then
    raise exception 'No copies available — request cannot be approved.';
  end if;

  -- R-14 / R-17: release starts the clock — due_date = current_date + 7 days
  insert into public.loans (request_id, student_id, book_id, copy_id,
                            due_date, released_by)
  values (p_request_id, v_student, v_book_id, p_copy_id,
          current_date + 7, v_profile)
  returning id into v_loan;

  -- R-14: link the request to the loan and record who released it
  update public.loan_requests
     set loan_id = v_loan,
         decided_by = v_profile
   where id = p_request_id;

  -- R-32: audit trail
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_profile, 'LOAN_RELEASE', 'loan', v_loan,
          jsonb_build_object('request_id', p_request_id,
                             'copy_id', p_copy_id,
                             'due_date', current_date + 7));

  return v_loan;
end $$;

-- -----------------------------------------------------------------------------
-- 2. run_overdue_sweep — R-16 (expiry), R-18 (daily overdue job), R-21 (one
--    fine per loan/type), E7 (safe to run twice a day: the fine is RECOMPUTED
--    from the due date, never accumulated). No admin gate: called by pg_cron.
-- -----------------------------------------------------------------------------
create or replace function public.run_overdue_sweep()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fee int;
begin
  -- fee rate from settings (rules §1), default ₱10.00 / day
  select coalesce((value #>> '{}')::int, 1000)
    into v_fee
    from public.settings
   where key = 'overdue_fee_per_day_centavos';
  v_fee := coalesce(v_fee, 1000);

  -- R-18 step 1: mark open loans past due as OVERDUE
  update public.loans
     set status = 'OVERDUE'
   where returned_at is null
     and status = 'ACTIVE'
     and due_date < current_date;

  -- R-18 steps 2–3 / E7: idempotent UPSERT — amount_centavos is RECOMPUTED as
  -- (current_date - due_date) * fee every run, so re-runs never double-charge.
  -- Conflict target must match partial unique index uq_fine_per_loan (R-21).
  insert into public.fines (student_id, loan_id, type, days_late,
                            amount_centavos, description)
  select l.student_id,
         l.id,
         'OVERDUE',
         (current_date - l.due_date),
         (current_date - l.due_date) * v_fee,
         format('%s day(s) late × ₱%s',
                (current_date - l.due_date), (v_fee / 100.0)::numeric(10, 2))
    from public.loans l
   where l.returned_at is null
     and l.due_date < current_date
  on conflict (loan_id, type) where loan_id is not null
  do update set days_late       = excluded.days_late,
                amount_centavos = excluded.amount_centavos,
                description     = excluded.description;

  -- R-16 / E7: expire PENDING requests older than expires_at (idempotent)
  update public.loan_requests
     set status = 'EXPIRED'
   where status = 'PENDING'
     and expires_at < now();
end $$;

-- -----------------------------------------------------------------------------
-- 3. record_return — R-20 (late return finalizes the exact-day fine),
--    R-07 (copy returns to AVAILABLE unless DAMAGED), R-19 (day-count maths),
--    R-32 (audit). Admin-only.
-- -----------------------------------------------------------------------------
create or replace function public.record_return(p_loan_id uuid, p_condition text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_loan    public.loans%rowtype;
  v_fee     int;
  v_days    int;
  v_profile uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin only';                       -- §9 matrix / R-31
  end if;

  if p_condition is null or p_condition not in ('GOOD', 'DAMAGED') then
    raise exception 'Invalid condition — expected GOOD or DAMAGED.';
  end if;

  select * into v_loan
    from public.loans
   where id = p_loan_id
     for update;
  if not found then
    raise exception 'Loan not found.';
  end if;
  if v_loan.returned_at is not null then
    raise exception 'Loan is already returned.';        -- E6: second admin loses
  end if;

  -- R-20: close the loan, record who received it and the returned condition
  update public.loans
     set returned_at        = now(),
         status             = 'RETURNED',
         condition_on_return = p_condition,
         returned_to        = v_profile
   where id = p_loan_id;

  -- R-07 / R-23: copy back in circulation, or pulled from circulation
  update public.book_copies
     set status = case when p_condition = 'GOOD' then 'AVAILABLE'
                       else 'DAMAGED' end
   where id = v_loan.copy_id;

  -- R-19 / R-20: finalize the exact-day OVERDUE fine when returned late
  if v_loan.due_date < current_date then
    select coalesce((value #>> '{}')::int, 1000)
      into v_fee
      from public.settings
     where key = 'overdue_fee_per_day_centavos';
    v_fee := coalesce(v_fee, 1000);
    v_days := current_date - v_loan.due_date;

    -- same idempotent upsert as the daily sweep (R-18 / E7 / R-21)
    insert into public.fines (student_id, loan_id, type, days_late,
                              amount_centavos, description)
    values (v_loan.student_id, v_loan.id, 'OVERDUE', v_days,
            v_days * v_fee,
            format('%s day(s) late × ₱%s', v_days, (v_fee / 100.0)::numeric(10, 2)))
    on conflict (loan_id, type) where loan_id is not null
    do update set days_late       = excluded.days_late,
                  amount_centavos = excluded.amount_centavos,
                  description     = excluded.description;
  end if;

  -- R-32: audit trail
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_profile, 'LOAN_RETURN', 'loan', p_loan_id,
          jsonb_build_object('condition', p_condition,
                             'due_date', v_loan.due_date,
                             'returned_late', v_loan.due_date < current_date));

  return p_loan_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. assess_damage — R-08 (replacement value is the damage charge basis),
--    R-21 (one DAMAGE fine per loan), R-22 (student accountability),
--    R-23 (damage workflow), R-32 (audit). Admin-only.
-- -----------------------------------------------------------------------------
create or replace function public.assess_damage(p_loan_id uuid,
                                                p_description text,
                                                p_photo_url text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_loan    public.loans%rowtype;
  v_value   int;
  v_report  uuid;
  v_profile uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin only';                       -- §9 matrix / R-31
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'Damage description is required.';
  end if;

  select * into v_loan
    from public.loans
   where id = p_loan_id
     for update;
  if not found then
    raise exception 'Loan not found.';
  end if;

  -- R-23 / E5: damage is assessed only on a loan already returned as DAMAGED
  if v_loan.returned_at is null
     or v_loan.status <> 'RETURNED'
     or v_loan.condition_on_return <> 'DAMAGED' then
    raise exception 'Mark the book returned as DAMAGED first.';
  end if;

  -- damage_reports.loan_id is UNIQUE — one assessment per loan
  if exists (select 1 from public.damage_reports where loan_id = p_loan_id) then
    raise exception 'Damage already assessed for this loan.';
  end if;

  -- R-08: assessed value is the book's replacement value at assessment time
  select b.replacement_value_centavos
    into v_value
    from public.books b
   where b.id = v_loan.book_id;

  insert into public.damage_reports (loan_id, student_id, book_id, copy_id,
                                     description, photo_url,
                                     assessed_value_centavos, status, assessed_by)
  values (v_loan.id, v_loan.student_id, v_loan.book_id, v_loan.copy_id,
          p_description, p_photo_url, v_value, 'PENDING', v_profile)
  returning id into v_report;

  -- R-22 / R-23: DAMAGE fine = replacement value, UNPAID, on the loan student;
  -- unique per (loan, type) via uq_fine_per_loan → do nothing on conflict (R-21)
  insert into public.fines (student_id, loan_id, type, amount_centavos,
                            status, description)
  values (v_loan.student_id, v_loan.id, 'DAMAGE', v_value, 'UNPAID',
          'Damage assessment — book replacement value')
  on conflict (loan_id, type) where loan_id is not null do nothing;

  -- R-32: audit trail
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_profile, 'DAMAGE_ASSESS', 'damage_report', v_report,
          jsonb_build_object('loan_id', p_loan_id,
                             'student_id', v_loan.student_id,
                             'copy_id', v_loan.copy_id,
                             'assessed_value_centavos', v_value));

  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 5. can_request — R-09 (all six eligibility conditions), R-10 (one pending
--    request per book), R-25 (hard block on unpaid fines), R-07 (≥1 AVAILABLE
--    copy). Settings read with coalesce defaults (rules §1).
-- -----------------------------------------------------------------------------
create or replace function public.can_request(p_student uuid, p_book uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- R-09.1: profile exists and is ACTIVE (R-04)
    exists (select 1 from public.profiles
             where id = p_student and status = 'ACTIVE')
    -- R-09.2 / R-25 / FR-20: zero UNPAID fines
    and not exists (select 1 from public.fines
                     where student_id = p_student and status = 'UNPAID')
    -- R-09.4: pending requests < max_pending_requests (default 3)
    and (select count(*) from public.loan_requests
          where student_id = p_student and status = 'PENDING')
        < coalesce((select (value #>> '{}')::int from public.settings
                     where key = 'max_pending_requests'), 3)
    -- R-09.5: active loans < max_active_loans (default 3)
    and (select count(*) from public.loans
          where student_id = p_student and returned_at is null)
        < coalesce((select (value #>> '{}')::int from public.settings
                     where key = 'max_active_loans'), 3)
    -- R-09.3 / R-10: no PENDING request already open for this book
    and not exists (select 1 from public.loan_requests
                     where student_id = p_student and book_id = p_book
                       and status = 'PENDING')
    -- R-09.6: the book has ≥ 1 AVAILABLE copy
    and exists (select 1 from public.book_availability
                 where book_id = p_book and available_copies > 0);
$$;

-- -----------------------------------------------------------------------------
-- 6. assert_can_request — server-action guard: evaluates can_request first,
--    then raises the exact user-facing messages from prd.md / rules.md
--    (R-09, R-10, R-25, FR-20, US-2, US-7).
-- -----------------------------------------------------------------------------
create or replace function public.assert_can_request(p_student uuid, p_book uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_max_pending int;
  v_max_loans   int;
begin
  -- fast path: every R-09 / R-25 condition holds
  if public.can_request(p_student, p_book) then
    return;
  end if;

  -- R-09.1 / R-04: profile must exist and be ACTIVE
  if not exists (select 1 from public.profiles
                  where id = p_student and status = 'ACTIVE') then
    raise exception 'You cannot request this book.';
  end if;

  -- R-09.2 / R-25 / FR-20 / US-7: unpaid balance hard-blocks new requests
  if exists (select 1 from public.fines
              where student_id = p_student and status = 'UNPAID') then
    raise exception 'Settle pending balance at the library to request new books.';
  end if;

  -- R-09.3 / R-10 / US-2: already requested this book
  if exists (select 1 from public.loan_requests
              where student_id = p_student
                and book_id = p_book
                and status = 'PENDING') then
    raise exception 'Already requested.';
  end if;

  select coalesce((value #>> '{}')::int, 3)
    into v_max_pending
    from public.settings
   where key = 'max_pending_requests';
  v_max_pending := coalesce(v_max_pending, 3);

  select coalesce((value #>> '{}')::int, 3)
    into v_max_loans
    from public.settings
   where key = 'max_active_loans';
  v_max_loans := coalesce(v_max_loans, 3);

  -- R-09.4: pending-request cap reached
  if (select count(*) from public.loan_requests
       where student_id = p_student and status = 'PENDING') >= v_max_pending then
    raise exception 'Request limit reached.';
  end if;

  -- R-09.5: active-loan cap reached
  if (select count(*) from public.loans
       where student_id = p_student and returned_at is null) >= v_max_loans then
    raise exception 'Request limit reached.';
  end if;

  -- R-09.6: no AVAILABLE copy right now
  if not exists (select 1 from public.book_availability
                  where book_id = p_book and available_copies > 0) then
    raise exception 'No copies available.';
  end if;

  -- defence in depth (R-31): a condition changed between the checks above
  raise exception 'You cannot request this book.';
end $$;
