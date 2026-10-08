-- =============================================================================
-- 0007_loan_time_and_release_guards.sql — Manila-day correctness + friendly
-- double-release error (findings from Phase 4a live testing, 62/62)
--
-- FIX 1 (R-14/R-18/R-20/R-30): current_date evaluates in the DB session
--   timezone (Supabase default UTC). Between 00:00-07:59 Asia/Manila the UTC
--   date is still "yesterday", so due_date / day counts would be 1 day behind
--   Manila's calendar. All business-day math now pins the timezone explicitly:
--   (now() AT TIME ZONE 'Asia/Manila')::date
--
-- FIX 2 (E6 / friendly UX): release_loan checked status='APPROVED' but not
--   loan_id IS NULL, so a direct second call raised raw 23505 duplicate-key.
--   Now raises 'This request has already been released.' (matches TS string).
--   (record_return already guards returned_at — adding a friendly pre-check
--   there too for consistency: 'Loan is already returned.' stays as-is.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- release_loan: Manila today + loan_id null guard
-- ---------------------------------------------------------------------------
create or replace function public.release_loan(p_request_id uuid, p_copy_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan   uuid;
  v_days   int;
  v_admin  uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select (value #>> '{}')::int into v_days
    from public.settings where key = 'loan_period_days';
  v_days := coalesce(v_days, 7);

  -- atomic availability flip (R-13)
  update public.book_copies
     set status = 'ON_LOAN'
   where id = p_copy_id
     and status = 'AVAILABLE';
  if not found then
    raise exception 'No copies available — request cannot be approved.';
  end if;

  -- create the loan; Manila-calendar due date (R-14/R-17/R-30)
  insert into public.loans (request_id, student_id, book_id, copy_id,
                            due_date, released_by)
  select lr.id, lr.student_id, lr.book_id, p_copy_id,
         ((now() at time zone 'Asia/Manila')::date + v_days),
         v_admin
    from public.loan_requests lr
   where lr.id = p_request_id
     and lr.status = 'APPROVED'
     and lr.loan_id is null          -- FIX 2: friendly double-release guard
  returning id into v_loan;

  if v_loan is null then
    -- distinguish the two failure causes for a clean message
    if exists (select 1 from public.loan_requests
                where id = p_request_id and loan_id is not null) then
      raise exception 'This request has already been released.';
    end if;
    raise exception 'Request not found or not approved.';
  end if;

  update public.loan_requests
     set loan_id = v_loan, decided_by = coalesce(decided_by, v_admin)
   where id = p_request_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_admin, 'LOAN_RELEASE', 'loan', v_loan,
          jsonb_build_object('request', p_request_id, 'copy', p_copy_id));

  return v_loan;
end;
$$;

-- ---------------------------------------------------------------------------
-- run_overdue_sweep: Manila today for overdue detection + day counts
-- ---------------------------------------------------------------------------
create or replace function public.run_overdue_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee     int;
  v_today   date := (now() at time zone 'Asia/Manila')::date;  -- R-30
begin
  select (value #>> '{}')::int into v_fee
    from public.settings where key = 'overdue_fee_per_day_centavos';
  v_fee := coalesce(v_fee, 1000);

  update public.loans
     set status = 'OVERDUE'
   where returned_at is null
     and status = 'ACTIVE'
     and due_date < v_today;

  -- idempotent: recomputed from due_date every run, never accumulated (R-18/E7)
  insert into public.fines (student_id, loan_id, type, days_late,
                            amount_centavos, description)
  select l.student_id, l.id, 'OVERDUE',
         (v_today - l.due_date),
         (v_today - l.due_date) * v_fee,
         (v_today - l.due_date)::text || ' day(s) late × ₱'
           || ((v_fee / 100.0)::numeric(10,2))::text
    from public.loans l
   where l.returned_at is null
     and l.due_date < v_today
  on conflict (loan_id, type) where loan_id is not null
  do update set days_late       = excluded.days_late,
                amount_centavos = excluded.amount_centavos,
                description     = excluded.description;

  update public.loan_requests
     set status = 'EXPIRED'
   where status = 'PENDING'
     and expires_at < now();
end;
$$;

-- ---------------------------------------------------------------------------
-- record_return: Manila-today finalization (R-20 exact-day math)
-- ---------------------------------------------------------------------------
create or replace function public.record_return(p_loan_id uuid, p_condition text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan    public.loans%rowtype;
  v_admin   uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Manila')::date;  -- R-30
  v_fee     int;
  v_days    int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  if p_condition not in ('GOOD', 'DAMAGED') then
    raise exception 'Invalid condition — expected GOOD or DAMAGED.';
  end if;

  select * into v_loan from public.loans where id = p_loan_id;
  if not found then
    raise exception 'Loan not found.';
  end if;
  if v_loan.returned_at is not null then
    raise exception 'Loan is already returned.';
  end if;

  update public.loans
     set returned_at         = now(),
         status              = 'RETURNED',
         condition_on_return = p_condition,
         returned_to         = v_admin
   where id = p_loan_id;

  update public.book_copies
     set status = case when p_condition = 'GOOD' then 'AVAILABLE' else 'DAMAGED' end
   where id = v_loan.copy_id;

  -- finalize exact-day overdue fine at return (R-20); damage fines are Phase 5
  if v_loan.due_date < v_today then
    select (value #>> '{}')::int into v_fee
      from public.settings where key = 'overdue_fee_per_day_centavos';
    v_fee := coalesce(v_fee, 1000);
    v_days := v_today - v_loan.due_date;

    insert into public.fines (student_id, loan_id, type, days_late,
                              amount_centavos, description)
    values (v_loan.student_id, v_loan.id, 'OVERDUE', v_days,
            v_days * v_fee,
            v_days::text || ' day(s) late × ₱' || ((v_fee / 100.0)::numeric(10,2))::text)
    on conflict (loan_id, type) where loan_id is not null
    do update set days_late       = excluded.days_late,
                  amount_centavos = excluded.amount_centavos,
                  description     = excluded.description;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_admin, 'LOAN_RETURN', 'loan', p_loan_id,
          jsonb_build_object('condition', p_condition,
                             'due_date', v_loan.due_date));

  return p_loan_id;
end;
$$;

comment on function public.release_loan(uuid, uuid) is
  'R-14/R-17/R-30: due = Manila-today + loan_period_days; E6: friendly double-release guard (0007).';
comment on function public.run_overdue_sweep() is
  'R-18/R-30: daily sweep using Manila calendar day; idempotent fine upsert (0007).';
comment on function public.record_return(uuid, text) is
  'R-20/R-30: return + exact-day overdue finalization on Manila calendar (0007).';
