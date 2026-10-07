# ESCR Library — Supabase setup

## Apply migrations
Run in order via the Supabase **SQL editor**: `migrations/0001_init.sql` → `0002_functions.sql` → `0003_cron.sql`,
or run `supabase db push` from this folder. All migrations are idempotent (safe to re-run).
`0003_cron.sql` needs the `pg_cron` extension (Dashboard → Database → Extensions); without it, it only raises a NOTICE.

## Checklist (schema.md §8)
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

## First-admin bootstrap (schema.md §5/§6)
1. Dashboard → **Authentication → Add user** (email + password). Public sign-up stays disabled — R-01 forbids self-registration.
2. Copy the new auth user's UUID, then insert its `profiles` row:
   ```sql
   insert into public.profiles (id, role, student_id, full_name, status)
   values ('<admin-auth-user-uuid>', 'ADMIN', null, 'ESCR Librarian', 'ACTIVE');
   ```
3. Confirm the `settings` seed rows exist (§5) — included in `0001_init.sql`.

## Required env vars
| Var | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public (RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** — never `NEXT_PUBLIC_`, never sent to the client |
