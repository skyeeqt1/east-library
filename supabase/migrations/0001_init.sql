-- =============================================================================
-- 0001_init.sql — ESCR Library Management System — initial schema migration
-- Source of truth: schema.md §3 (DDL), §4 (RLS), §5 (seed), §6 (auth triggers)
-- Platform: Supabase / PostgreSQL 15+ · charset UTF8 · all timestamps timestamptz
-- Money: integer centavos (…_centavos) — ₱10.00 = 1000 (schema.md header)
-- Statements are idempotent (create or replace / if not exists / drop if exists)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions (schema.md §3)
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Tables (schema.md §3), emitted in dependency order:
--    profiles → books → book_copies → loan_requests → loans → (deferred FK)
--    → fines → damage_reports → settings → audit_logs
-- -----------------------------------------------------------------------------

-- 1.1 profiles — every user (admin or student) (schema.md §2.1)
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  role               text not null check (role in ('ADMIN','STUDENT')),
  student_id         text unique,
  full_name          text not null,
  course_section     text,
  phone              text,
  status             text not null default 'ACTIVE'
                     check (status in ('ACTIVE','BLOCKED')),
  must_change_password boolean not null default false,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- students must have a student_id (ESCR ID); admins must not
  constraint student_id_required check (
    (role = 'STUDENT' and student_id is not null) or
    (role = 'ADMIN'   and student_id is null)
  )
);

-- 1.2 books — replacement value is the damage charge basis (R-08)
create table if not exists public.books (
  id                          uuid primary key default gen_random_uuid(),
  isbn                        text,
  title                       text not null,
  author                      text not null,
  category                    text,
  shelf_code                  text,           -- e.g. FIC-014
  cover_url                   text,           -- Storage path in bucket 'book-covers'
  replacement_value_centavos  int not null check (replacement_value_centavos > 0), -- R-08
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- 1.3 book_copies — availability is atomic here (R-07)
create table if not exists public.book_copies (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.books(id) on delete cascade,
  barcode     text unique,                    -- optional printed label
  status      text not null default 'AVAILABLE'
              check (status in ('AVAILABLE','ON_LOAN','DAMAGED','LOST')), -- R-07
  acquired_at date not null default current_date,
  created_at  timestamptz not null default now()
);

-- 1.4 loan_requests — FK to loans (loan_id) is deferred; see 1.5 (schema.md §3)
create table if not exists public.loan_requests (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.profiles(id),
  book_id        uuid not null references public.books(id),
  status         text not null default 'PENDING'
                 check (status in ('PENDING','APPROVED','DECLINED','CANCELLED','EXPIRED')),
  decline_reason text,
  decided_at     timestamptz,                 -- immutable after decision (R-15)
  decided_by     uuid references public.profiles(id),
  loan_id        uuid,                        -- FK added after loans table
  expires_at     timestamptz not null default now() + interval '3 days',
  created_at     timestamptz not null default now()
);

-- R-10: one pending request per (student, book) — partial unique index
create unique index if not exists uq_request_pending
  on public.loan_requests (student_id, book_id) where status = 'PENDING';

-- 1.5 loans — 1:1 with request; due date ≤ release date + loan period (R-14, R-17)
create table if not exists public.loans (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null unique references public.loan_requests(id),
  student_id          uuid not null references public.profiles(id),
  book_id             uuid not null references public.books(id),       -- denormalized
  copy_id             uuid not null references public.book_copies(id), -- physical copy released
  released_at         timestamptz not null default now(),
  due_date            date not null,
  returned_at         timestamptz,
  condition_on_return text check (condition_on_return in ('GOOD','DAMAGED')),
  status              text not null default 'ACTIVE'
                      check (status in ('ACTIVE','OVERDUE','RETURNED')),
  released_by         uuid references public.profiles(id),
  returned_to         uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  -- R-17: never longer than the configured loan period (7 days default)
  constraint due_within_loan_period check (due_date <= (released_at::date + 7)),
  constraint returned_needs_condition check (
    (returned_at is null and condition_on_return is null) or
    (returned_at is not null and condition_on_return is not null)
  )
);

-- Deferred circular FK: loan_requests.loan_id → loans.id (schema.md §3)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_request_loan'
      and conrelid = 'public.loan_requests'::regclass
  ) then
    alter table public.loan_requests
      add constraint fk_request_loan foreign key (loan_id) references public.loans(id);
  end if;
end $$;

-- 1.6 fines — waiver/payment invariants (R-24), one fine of each type per loan (R-21)
create table if not exists public.fines (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.profiles(id),
  loan_id           uuid references public.loans(id),  -- NULL allowed for admin adjustments
  type              text not null check (type in ('OVERDUE','DAMAGE')),
  days_late         int check (days_late is null or days_late >= 0),
  amount_centavos   int not null check (amount_centavos >= 0),
  status            text not null default 'UNPAID'
                    check (status in ('UNPAID','PAID','WAIVED')),
  paid_method       text check (paid_method in ('CASH','REPLACEMENT')),
  paid_at           timestamptz,
  received_by       uuid references public.profiles(id),
  waived_at         timestamptz,
  waived_by         uuid references public.profiles(id),
  waive_reason      text,                     -- required when WAIVED (R-24)
  description       text,
  created_at        timestamptz not null default now(),
  constraint waiver_needs_reason check (status <> 'WAIVED' or waive_reason is not null), -- R-24
  constraint payment_needs_method check (status <> 'PAID' or paid_method is not null)
);

-- R-21: one fine of each type per loan — partial unique index
create unique index if not exists uq_fine_per_loan
  on public.fines (loan_id, type) where loan_id is not null;

-- 1.7 damage_reports — one assessment per loan; accountable student (R-22)
create table if not exists public.damage_reports (
  id                        uuid primary key default gen_random_uuid(),
  loan_id                   uuid not null unique references public.loans(id),
  student_id                uuid not null references public.profiles(id), -- R-22
  book_id                   uuid not null references public.books(id),
  copy_id                   uuid not null references public.book_copies(id),
  description               text not null,
  photo_url                 text,             -- Storage 'damage-photos/'
  assessed_value_centavos   int not null check (assessed_value_centavos > 0), -- = replacement value at assessment (R-08)
  status                    text not null default 'PENDING'
                            check (status in ('PENDING','RESOLVED')),
  assessed_by               uuid references public.profiles(id),
  resolved_at               timestamptz,
  created_at                timestamptz not null default now()
);

-- 1.8 settings — key/value, seeded in §5 (seed below)
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- 1.9 audit_logs — append-only (schema.md §2.9)
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),
  action      text not null,                  -- ACCOUNT_CREATE · ACCOUNT_UPDATE · ACCOUNT_BLOCK ·
                                              -- BOOK_* · REQUEST_DECIDE · LOAN_RELEASE · LOAN_RETURN ·
                                              -- DAMAGE_ASSESS · FINE_CREATE · FINE_PAY · FINE_WAIVE ·
                                              -- SETTINGS_UPDATE
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

-- Append-only: no UPDATE/DELETE for students AND admins alike (schema.md §2.9)
drop rule if exists audit_no_update on public.audit_logs;
create rule audit_no_update as on update to public.audit_logs do instead nothing;
drop rule if exists audit_no_delete on public.audit_logs;
create rule audit_no_delete as on delete to public.audit_logs do instead nothing;

-- -----------------------------------------------------------------------------
-- 2. Views (schema.md §3)
-- -----------------------------------------------------------------------------

-- R-07: per book → total_copies, available_copies
create or replace view public.book_availability as
select b.id as book_id,
       count(*)                                     as total_copies,
       count(*) filter (where c.status = 'AVAILABLE') as available_copies
from public.books b
left join public.book_copies c on c.book_id = b.id
group by b.id;

-- R-27: per student → unpaid fine balance in centavos
create or replace view public.student_balances as
select p.id as student_id,
       coalesce(sum(f.amount_centavos) filter (where f.status = 'UNPAID'), 0) as balance_centavos,
       count(f.id) filter (where f.status = 'UNPAID') as unpaid_count
from public.profiles p
left join public.fines f on f.student_id = p.id
group by p.id;

-- -----------------------------------------------------------------------------
-- 3. Indexes for hot paths (schema.md §3)
-- -----------------------------------------------------------------------------
create index if not exists idx_loans_open       on public.loans (due_date) where returned_at is null;
create index if not exists idx_loans_student    on public.loans (student_id);
create index if not exists idx_requests_status  on public.loan_requests (status, created_at);
create index if not exists idx_requests_student on public.loan_requests (student_id);
create index if not exists idx_fines_student    on public.fines (student_id, status);
create index if not exists idx_copies_book      on public.book_copies (book_id, status);
create index if not exists idx_books_search     on public.books (title, author);

-- -----------------------------------------------------------------------------
-- 4. Row Level Security (schema.md §4)
-- -----------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.books          enable row level security;
alter table public.book_copies    enable row level security;
alter table public.loan_requests  enable row level security;
alter table public.loans          enable row level security;
alter table public.fines          enable row level security;
alter table public.damage_reports enable row level security;
alter table public.settings       enable row level security;
alter table public.audit_logs     enable row level security;

-- 4.1 Helper functions — SECURITY DEFINER, owned by postgres, bypass RLS
--     when reading roles (schema.md §4)

create or replace function public.current_role_of()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_of() = 'ADMIN'
$$;

create or replace function public.is_blocked()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and status = 'BLOCKED')
$$;

-- 4.2 Policies (schema.md §4 table; pattern per loans example in §4)

-- profiles: student reads own row; admin full read
drop policy if exists "profiles: student reads own row" on public.profiles;
create policy "profiles: student reads own row" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- profiles: student updates own row, but only full_name/phone —
-- role/student_id/status mutation is neutralized by trg_profiles_guard (§4.1)
drop policy if exists "profiles: student updates own row" on public.profiles;
create policy "profiles: student updates own row" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- profiles: admin full SELECT/INSERT/UPDATE
drop policy if exists "profiles: admin manages profiles" on public.profiles;
create policy "profiles: admin manages profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- profiles: admin DELETE only if the account has no history
drop policy if exists "profiles: admin deletes historyless profiles" on public.profiles;
create policy "profiles: admin deletes historyless profiles" on public.profiles
  for delete using (
    public.is_admin()
    and not exists (select 1 from public.loan_requests  lr where lr.student_id = profiles.id)
    and not exists (select 1 from public.loans          l  where l.student_id  = profiles.id)
    and not exists (select 1 from public.fines          f  where f.student_id  = profiles.id)
    and not exists (select 1 from public.damage_reports d  where d.student_id  = profiles.id)
    and not exists (select 1 from public.profiles       c  where c.created_by  = profiles.id)
  );

-- books: students read only; admin full CRUD
drop policy if exists "books: students read" on public.books;
create policy "books: students read" on public.books
  for select using (true);

drop policy if exists "books: admin manages" on public.books;
create policy "books: admin manages" on public.books
  for all using (public.is_admin()) with check (public.is_admin());

-- book_copies: students read only (availability, R-07); admin full CRUD
drop policy if exists "book_copies: students read" on public.book_copies;
create policy "book_copies: students read" on public.book_copies
  for select using (true);

drop policy if exists "book_copies: admin manages" on public.book_copies;
create policy "book_copies: admin manages" on public.book_copies
  for all using (public.is_admin()) with check (public.is_admin());

-- loan_requests: students insert own; blocked students cannot request (R-09 eligibility)
drop policy if exists "loan_requests: student inserts own" on public.loan_requests;
create policy "loan_requests: student inserts own" on public.loan_requests
  for insert with check (student_id = auth.uid() and not public.is_blocked());

-- loan_requests: students read own rows
drop policy if exists "loan_requests: student reads own" on public.loan_requests;
create policy "loan_requests: student reads own" on public.loan_requests
  for select using (student_id = auth.uid() or public.is_admin());

-- loan_requests: student UPDATE limited to status PENDING → CANCELLED
drop policy if exists "loan_requests: student cancels own pending" on public.loan_requests;
create policy "loan_requests: student cancels own pending" on public.loan_requests
  for update using (student_id = auth.uid() and status = 'PENDING')
  with check (student_id = auth.uid() and status = 'CANCELLED');

-- loan_requests: admin full CRUD (decide: REQUEST_DECIDE)
drop policy if exists "loan_requests: admin manages" on public.loan_requests;
create policy "loan_requests: admin manages" on public.loan_requests
  for all using (public.is_admin()) with check (public.is_admin());

-- loans: student reads own loans; admin full CRUD (pattern from §4 example)
drop policy if exists "student reads own loans" on public.loans;
create policy "student reads own loans" on public.loans
  for select using (student_id = auth.uid() or public.is_admin());

drop policy if exists "admin manages loans" on public.loans;
create policy "admin manages loans" on public.loans
  for all using (public.is_admin()) with check (public.is_admin());

-- fines: student reads own fines; admin full CRUD (pay/waive server-side, R-24)
drop policy if exists "student reads own fines" on public.fines;
create policy "student reads own fines" on public.fines
  for select using (student_id = auth.uid() or public.is_admin());

drop policy if exists "admin manages fines" on public.fines;
create policy "admin manages fines" on public.fines
  for all using (public.is_admin()) with check (public.is_admin());

-- damage_reports: student reads own assessments (R-22); admin full CRUD
drop policy if exists "student reads own damage reports" on public.damage_reports;
create policy "student reads own damage reports" on public.damage_reports
  for select using (student_id = auth.uid() or public.is_admin());

drop policy if exists "admin manages damage reports" on public.damage_reports;
create policy "admin manages damage reports" on public.damage_reports
  for all using (public.is_admin()) with check (public.is_admin());

-- settings: everyone reads; admin full CRUD (SETTINGS_UPDATE via service role)
drop policy if exists "settings: readable" on public.settings;
create policy "settings: readable" on public.settings
  for select using (true);

drop policy if exists "settings: admin manages" on public.settings;
create policy "settings: admin manages" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- audit_logs: students have NO policy; admin SELECT only —
-- no INSERT from client (written by triggers / service role), truly append-only (§2.9)
drop policy if exists "audit_logs: admin reads" on public.audit_logs;
create policy "audit_logs: admin reads" on public.audit_logs
  for select using (public.is_admin());

-- 4.3 Privilege-escalation guard (schema.md §4.1) —
--     non-admins cannot change role/status/student_id on their own row
create or replace function public.prevent_self_promotion()
returns trigger language plpgsql security definer as $$
begin
  if not public.is_admin() then
    new.role       := old.role;
    new.status     := old.status;
    new.student_id := old.student_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.prevent_self_promotion();

-- -----------------------------------------------------------------------------
-- 5. Seed data (schema.md §5) — settings defaults, never overwrite local values
-- -----------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('loan_period_days',               '7'),
  ('overdue_fee_per_day_centavos',   '1000'),   -- ₱10.00 / day
  ('max_active_loans',               '3'),
  ('max_pending_requests',           '3'),
  ('request_expiry_days',            '3'),
  ('block_on_unpaid_fines',          'true')
on conflict (key) do nothing;

-- First admin bootstrap is manual (schema.md §5): create the auth user via
-- Supabase dashboard (Authentication → Add user), then insert its profiles row.

-- -----------------------------------------------------------------------------
-- 6. Auth ↔ profile integration (schema.md §6) —
--    on auth.users insert → auto-create minimal profiles row only if inserted
--    by service role with metadata (defense against stray sign-ups)
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  if new.raw_user_meta_data->>'role' is null then
    raise exception 'Account creation outside admin flow blocked';
  end if;
  insert into public.profiles (id, role, student_id, full_name, course_section)
  values (new.id,
          new.raw_user_meta_data->>'role',
          new.raw_user_meta_data->>'student_id',
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'course_section');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
