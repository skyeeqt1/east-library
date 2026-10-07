# ESCR Library Management System — Database Schema (Supabase)

**Platform:** Supabase (Postgres 15+) · **Charset:** `UTF8` · **Timezone:** all timestamps `timestamptz`, app timezone `Asia/Manila`.
**Money:** integer **centavos** (`…_centavos`) — ₱10.00 = `1000`.
**Conventions:** `snake_case`, PK `uuid default gen_random_uuid()`, every table has
`created_at timestamptz default now()`, FKs with explicit `ON DELETE` behavior.

---

## 1. Entity Relationship Diagram

```
auth.users (Supabase)
   │ 1:1
   ▼
profiles ─────────────┐ (role: ADMIN | STUDENT, student_id unique)
   │                  │
   │ 1:N              │ 1:N
   ▼                  ▼
loan_requests ────► loans ◄──── book_copies ◄──── books
 (PENDING/…)   1:1   │ 1:N            │             │
                     ▼                │             │ 1:N
                  fines ◄─────────────┘             │
                     │                              │
                     └── damage_reports ◄───────────┘
 settings (key/value)          audit_logs (append-only)
```

**Cardinality highlights**
- `profiles` 1—1 `auth.users`
- `books` 1—N `book_copies` (availability lives on copies)
- `loan_requests` 1—0..1 `loans` (approval → release)
- `loans` 1—N `fines`; `loans` 1—0..1 `damage_reports`
- `profiles` 1—N requests / loans / fines / damage_reports

---

## 2. Tables

### 2.1 `profiles` — every user (admin or student)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| role | text | `ADMIN` \| `STUDENT`, check-constrained |
| student_id | text UNIQUE NULL | required when role = STUDENT (ESCR ID) |
| full_name | text NOT NULL | |
| course_section | text NULL | e.g. `BSIT 2A` |
| phone | text NULL | |
| status | text | `ACTIVE` \| `BLOCKED`, default `ACTIVE` |
| must_change_password | bool | default false |
| created_by | uuid FK→profiles | admin who created the account |
| created_at / updated_at | timestamptz | |

> Login mapping: students use synthetic auth email `{student_id}@escr.students`
> (see §6). Admins use a real email.

### 2.2 `books`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| isbn | text NULL | |
| title | text NOT NULL | |
| author | text NOT NULL | |
| category | text NULL | |
| shelf_code | text NULL | e.g. `FIC-014` |
| cover_url | text NULL | Storage path in `book-covers` |
| replacement_value_centavos | int NOT NULL CHECK (> 0) | damage charge basis (R-08) |
| total_copies | int GENERATED | `= count(book_copies)` |
| created_at / updated_at | timestamptz | |

### 2.3 `book_copies` — availability is atomic here (R-07)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| book_id | uuid FK→books ON DELETE CASCADE | |
| barcode | text UNIQUE NULL | optional printed label |
| status | text | `AVAILABLE` \| `ON_LOAN` \| `DAMAGED` \| `LOST`, default `AVAILABLE` |
| acquired_at | date | |

**View `book_availability`:** per book → `total_copies`, `available_copies`.

### 2.4 `loan_requests`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK→profiles | requester |
| book_id | uuid FK→books | |
| status | text | `PENDING` \| `APPROVED` \| `DECLINED` \| `CANCELLED` \| `EXPIRED` |
| decline_reason | text NULL | |
| decided_at | timestamptz NULL | immutable after decision (R-15) |
| decided_by | uuid FK→profiles NULL | |
| loan_id | uuid FK→loans NULL | set on release |
| expires_at | timestamptz | `created_at + interval '3 days'` |
| created_at | timestamptz | |

**Constraints:** `UNIQUE (student_id, book_id)` **partial index** WHERE
`status = 'PENDING'` (R-10).

### 2.5 `loans`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| request_id | uuid FK→loan_requests UNIQUE | 1:1 with request |
| student_id | uuid FK→profiles | |
| book_id | uuid FK→books | denormalized for fast queries |
| copy_id | uuid FK→book_copies | the physical copy released |
| released_at | timestamptz default now() | |
| due_date | date NOT NULL | = release date + 7 (R-14, R-17) |
| returned_at | timestamptz NULL | |
| condition_on_return | text NULL | `GOOD` \| `DAMAGED` |
| status | text | `ACTIVE` \| `OVERDUE` \| `RETURNED` |
| released_by / returned_to | uuid FK→profiles | admin actors |

### 2.6 `fines`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK→profiles | who pays |
| loan_id | uuid FK→loans NULL | NULL allowed for admin-created adjustments |
| type | text | `OVERDUE` \| `DAMAGE` |
| days_late | int NULL | for OVERDUE |
| amount_centavos | int NOT NULL CHECK (≥ 0) | |
| status | text | `UNPAID` \| `PAID` \| `WAIVED` |
| paid_method | text NULL | `CASH` \| `REPLACEMENT` |
| paid_at / waived_at | timestamptz NULL | |
| received_by / waived_by | uuid FK→profiles NULL | |
| waive_reason | text NULL | required when WAIVED (R-24) |
| description | text NULL | human-readable, e.g. `"3 days late × ₱10"` |

**Constraint:** `UNIQUE (loan_id, type)` **partial index** WHERE
`loan_id IS NOT NULL` (R-21) — no duplicate charges per loan.

### 2.7 `damage_reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| loan_id | uuid FK→loans UNIQUE | one assessment per loan |
| student_id | uuid FK→profiles | accountable student (R-22) |
| book_id / copy_id | uuid FK | |
| description | text NOT NULL | what is damaged |
| photo_url | text NULL | Storage `damage-photos/` |
| assessed_value_centavos | int NOT NULL | = book replacement value at time of assessment |
| status | text | `PENDING` \| `RESOLVED` |
| assessed_by | uuid FK→profiles | admin |
| resolved_at | timestamptz NULL | |

### 2.8 `settings`
| Column | Type | Notes |
|---|---|---|
| key | text PK | `loan_period_days`, `overdue_fee_per_day_centavos`, `max_active_loans`, `max_pending_requests`, `block_on_unpaid_fines`, `request_expiry_days` |
| value | jsonb NOT NULL | |
| updated_by | uuid FK→profiles | |
| updated_at | timestamptz | |

**Seed defaults:** see §5.

### 2.9 `audit_logs` (append-only)
`id, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip inet NULL, created_at`
Actions: `ACCOUNT_CREATE · ACCOUNT_UPDATE · ACCOUNT_BLOCK · BOOK_* · REQUEST_DECIDE ·
LOAN_RELEASE · LOAN_RETURN · DAMAGE_ASSESS · FINE_CREATE · FINE_PAY · FINE_WAIVE · SETTINGS_UPDATE`.
**No UPDATE/DELETE policy** — truly append-only for students and admins alike.

---

## 3. SQL DDL

```sql
-- 0. Extensions
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";

-- 1. Enums as check-constrained text (flexible, easier migrations)
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  role               text not null check (role in ('ADMIN','STUDENT')),
  student_id         text unique,
  full_name          text not null,
  course_section     text,
  phone              text,
  status             text not null default 'ACTIVE' check (status in ('ACTIVE','BLOCKED')),
  must_change_password boolean not null default false,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- students must have a student_id; admins must not
  constraint student_id_required check (
    (role = 'STUDENT' and student_id is not null) or
    (role = 'ADMIN'   and student_id is null)
  )
);

create table public.books (
  id                          uuid primary key default gen_random_uuid(),
  isbn                        text,
  title                       text not null,
  author                      text not null,
  category                    text,
  shelf_code                  text,
  cover_url                   text,
  replacement_value_centavos  int not null check (replacement_value_centavos > 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table public.book_copies (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.books(id) on delete cascade,
  barcode     text unique,
  status      text not null default 'AVAILABLE'
              check (status in ('AVAILABLE','ON_LOAN','DAMAGED','LOST')),
  acquired_at date not null default current_date,
  created_at  timestamptz not null default now()
);

create table public.loan_requests (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.profiles(id),
  book_id        uuid not null references public.books(id),
  status         text not null default 'PENDING'
                 check (status in ('PENDING','APPROVED','DECLINED','CANCELLED','EXPIRED')),
  decline_reason text,
  decided_at     timestamptz,
  decided_by     uuid references public.profiles(id),
  loan_id        uuid,                        -- FK added after loans table
  expires_at     timestamptz not null default now() + interval '3 days',
  created_at     timestamptz not null default now()
);
-- R-10: one pending request per (student, book)
create unique index uq_request_pending
  on public.loan_requests (student_id, book_id) where status = 'PENDING';

create table public.loans (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null unique references public.loan_requests(id),
  student_id          uuid not null references public.profiles(id),
  book_id             uuid not null references public.books(id),
  copy_id             uuid not null references public.book_copies(id),
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
alter table public.loan_requests
  add constraint fk_request_loan foreign key (loan_id) references public.loans(id);

create table public.fines (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.profiles(id),
  loan_id           uuid references public.loans(id),
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
  waive_reason      text,
  description       text,
  created_at        timestamptz not null default now(),
  constraint waiver_needs_reason check (status <> 'WAIVED' or waive_reason is not null),
  constraint payment_needs_method check (status <> 'PAID' or paid_method is not null)
);
-- R-21: one fine of each type per loan
create unique index uq_fine_per_loan on public.fines (loan_id, type)
  where loan_id is not null;

create table public.damage_reports (
  id                        uuid primary key default gen_random_uuid(),
  loan_id                   uuid not null unique references public.loans(id),
  student_id                uuid not null references public.profiles(id),
  book_id                   uuid not null references public.books(id),
  copy_id                   uuid not null references public.book_copies(id),
  description               text not null,
  photo_url                 text,
  assessed_value_centavos   int not null check (assessed_value_centavos > 0),
  status                    text not null default 'PENDING'
                            check (status in ('PENDING','RESOLVED')),
  assessed_by               uuid references public.profiles(id),
  resolved_at               timestamptz,
  created_at                timestamptz not null default now()
);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
-- append-only
create rule audit_no_update as on update to public.audit_logs do instead nothing;
create rule audit_no_delete as on delete to public.audit_logs do instead nothing;

-- 2. Availability view (R-07)
create or replace view public.book_availability as
select b.id as book_id,
       count(*)                          as total_copies,
       count(*) filter (where c.status = 'AVAILABLE') as available_copies
from public.books b
left join public.book_copies c on c.book_id = b.id
group by b.id;

-- 3. Student balance view (R-27)
create or replace view public.student_balances as
select p.id as student_id,
       coalesce(sum(f.amount_centavos) filter (where f.status = 'UNPAID'), 0) as balance_centavos,
       count(f.id) filter (where f.status = 'UNPAID') as unpaid_count
from public.profiles p
left join public.fines f on f.student_id = p.id
group by p.id;

-- 4. Indexes for hot paths
create index idx_loans_open        on public.loans (due_date) where returned_at is null;
create index idx_loans_student     on public.loans (student_id);
create index idx_requests_status   on public.loan_requests (status, created_at);
create index idx_requests_student  on public.loan_requests (student_id);
create index idx_fines_student     on public.fines (student_id, status);
create index idx_copies_book       on public.book_copies (book_id, status);
create index idx_books_search      on public.books (title, author);
```

---

## 4. Row Level Security (Supabase)

Enable on every table: `alter table public.X enable row level security;`

**Helper functions** (SECURITY DEFINER, owned by postgres, bypass RLS when reading roles):

```sql
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
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'BLOCKED')
$$;
```

**Policies**

| Table | STUDENT policy | ADMIN policy |
|---|---|---|
| `profiles` | `SELECT` own row (`id = auth.uid()`); `UPDATE` own row but **only** `full_name, phone` (role/student_id/status are admin-only — enforce with a trigger, §4.1) | full `SELECT/INSERT/UPDATE`; `DELETE` only if no history |
| `books` | `SELECT` only | full CRUD |
| `book_copies` | `SELECT` only | full CRUD |
| `loan_requests` | `INSERT` own (`student_id = auth.uid()`); `SELECT` own; `UPDATE` own limited to `status='PENDING' → 'CANCELLED'` | full CRUD |
| `loans` | `SELECT` where `student_id = auth.uid()` | full CRUD |
| `fines` | `SELECT` where `student_id = auth.uid()` | full CRUD |
| `damage_reports` | `SELECT` where `student_id = auth.uid()` | full CRUD |
| `settings` | `SELECT` | full CRUD |
| `audit_logs` | none | `SELECT` (no insert from client — written by triggers/service role) |

Example policy (pattern repeated per table):

```sql
-- loans
create policy "student reads own loans" on public.loans
  for select using (student_id = auth.uid() or public.is_admin());

create policy "admin manages loans" on public.loans
  for all using (public.is_admin()) with check (public.is_admin());
```

**Key security decisions**
- **No client-side writes** for approvals, releases, returns, fines, damage, settings,
  or account creation: these run in **server actions using the service-role key**,
  which bypasses RLS *only inside guarded Next.js server code*.
- Service-role key is never prefixed with `NEXT_PUBLIC_`.
- Students can never see `decided_by`, other students' rows, or admin columns' mutation paths.

#### 4.1 Privilege-escalation guard (trigger)

```sql
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

create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.prevent_self_promotion();
```

---

## 5. Seed Data

```sql
insert into public.settings (key, value) values
  ('loan_period_days',               '7'),
  ('overdue_fee_per_day_centavos',   '1000'),   -- ₱10.00 / day
  ('max_active_loans',               '3'),
  ('max_pending_requests',           '3'),
  ('request_expiry_days',            '3'),
  ('block_on_unpaid_fines',          'true');

insert into public.profiles (id, role, student_id, full_name, status)
values ('<admin-auth-user-uuid>', 'ADMIN', null, 'ESCR Librarian', 'ACTIVE');
-- Admin auth.users row is created via Supabase dashboard / admin API first.
```

> **First admin bootstrap:** create the auth user in the Supabase dashboard
> (Authentication → Add user), then insert its `profiles` row. All other accounts are
> created in-app by that admin.

---

## 6. Auth ↔ Profile integration

| Concern | Implementation |
|---|---|
| Sign-up | **Disabled** (Supabase dashboard → Auth → Disable new sign-ups). App exposes no `/signup` route. |
| Account creation | Server action (admin-guarded) → `admin.createUser({ email, password, email_confirm: true })` → insert `profiles`. |
| Student email mapping | `email = lower(student_id) \|\| '@escr.students'` — students type their Student ID; server resolves the email before `signInWithPassword`. |
| New-user trigger | `on auth.users insert` → auto-create minimal `profiles` row **only if** inserted by service role with metadata (defense against stray sign-ups). |

```sql
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 7. Core Business Logic in SQL

### 7.1 Release a loan (R-14, R-17) — called by admin server action
```sql
create or replace function public.release_loan(p_request_id uuid, p_copy_id uuid)
returns uuid language plpgsql security definer as $$
declare v_loan uuid; v_days int; v_profile uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select value into v_days from public.settings where key = 'loan_period_days';
  v_days := coalesce(v_days::text::int, 7);

  -- atomic: only one available copy, flip it, create loan, link request
  update public.book_copies set status = 'ON_LOAN'
   where id = p_copy_id and status = 'AVAILABLE';
  if not found then raise exception 'No copies available — request cannot be approved.'; end if;

  insert into public.loans (request_id, student_id, book_id, copy_id,
                            due_date, released_by)
  select lr.id, lr.student_id, lr.book_id, p_copy_id,
         (current_date + v_days), v_profile
    from public.loan_requests lr where lr.id = p_request_id and lr.status = 'APPROVED'
  returning id into v_loan;

  update public.loan_requests set loan_id = v_loan, decided_by = v_profile
   where id = p_request_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (v_profile, 'LOAN_RELEASE', 'loan', v_loan,
          jsonb_build_object('request', p_request_id, 'copy', p_copy_id));
  return v_loan;
end $$;
```

### 7.2 Daily overdue job (R-18) — pg_cron at 00:05 Asia/Manila
```sql
create or replace function public.run_overdue_sweep()
returns void language plpgsql security definer as $$
declare v_fee int;
begin
  select value into v_fee from public.settings where key = 'overdue_fee_per_day_centavos';
  v_fee := coalesce(v_fee::text::int, 1000);

  -- mark overdue
  update public.loans
     set status = 'OVERDUE'
   where returned_at is null and status = 'ACTIVE' and due_date < current_date;

  -- idempotent fine upsert (recomputed, never accumulated — R-18)
  insert into public.fines (student_id, loan_id, type, days_late,
                            amount_centavos, description)
  select l.student_id, l.id, 'OVERDUE',
         (current_date - l.due_date),
         (current_date - l.due_date) * v_fee,
         (current_date - l.due_date) || ' day(s) late × ₱'
           || (v_fee / 100.0)::numeric(10,2)
  from public.loans l
  where l.returned_at is null and l.due_date < current_date
  on conflict (loan_id, type) where loan_id is not null
  do update set days_late        = excluded.days_late,
                amount_centavos  = excluded.amount_centavos,
                description      = excluded.description;

  -- expire stale requests
  update public.loan_requests set status = 'EXPIRED'
   where status = 'PENDING' and expires_at < now();
end $$;

select cron.schedule('overdue-sweep', '5 0 * * *',
                     $$select public.run_overdue_sweep()$$);
```

### 7.3 Student balance / request eligibility (R-09, R-25)
```sql
create or replace function public.can_request(p_student uuid, p_book uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles
             where id = p_student and status = 'ACTIVE')
    and not exists (select 1 from public.fines
                     where student_id = p_student and status = 'UNPAID')
    and (select count(*) from public.loan_requests
          where student_id = p_student and status = 'PENDING')
        < coalesce((select (value #>> '{}')::int from public.settings
                     where key = 'max_pending_requests'), 3)
    and (select count(*) from public.loans
          where student_id = p_student and returned_at is null)
        < coalesce((select (value #>> '{}')::int from public.settings
                     where key = 'max_active_loans'), 3)
    and not exists (select 1 from public.loan_requests
                     where student_id = p_student and book_id = p_book
                       and status = 'PENDING')
    and exists (select 1 from public.book_availability
                 where book_id = p_book and available_copies > 0);
$$;
```

---

## 8. Migration / Environment Checklist

- [ ] Enable RLS on all 9 tables (§4)
- [ ] Run DDL (§3) via Supabase SQL editor or a migration file
- [ ] Seed settings + first admin (§5)
- [ ] Disable public sign-up in Auth settings (§6)
- [ ] Create Storage buckets `book-covers`, `damage-photos` (private, admin-write)
- [ ] Schedule `overdue-sweep` cron (§7.2) — confirm timezone `Asia/Manila`
- [ ] Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- [ ] Rotate anon/service keys if ever exposed
- [ ] Verify with test users: student A cannot read student B's loans (RLS smoke test)
