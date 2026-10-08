-- =============================================================================
-- 0004_fix_audit_actor_fk.sql — let audit actors be deleted (R-32 / lifecycle)
--
-- Bug found by Phase 3a live smoke test: audit_logs is append-only (rules R-32,
-- no client DELETE) and actor_id had NO ON DELETE action, so once a user had
-- written any audit row, auth.admin.deleteUser() failed with a generic 500
-- ("Database error deleting user") — the student was undeletable.
--
-- Fix: ON DELETE SET NULL — the audit history is preserved (actor becomes NULL
-- = "former user"), while account deletion works. This matches the intent of
-- append-only: rows are never removed, only the living reference is released.
-- =============================================================================

do $do$
declare
  v_constraint text;
begin
  select con.conname
    into v_constraint
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'audit_logs'
     and con.contype = 'f'
     and con.conname like '%actor_id%';

  if v_constraint is null then
    raise notice 'audit_logs actor FK not found — nothing to do';
  else
    execute format('alter table public.audit_logs drop constraint %I', v_constraint);
    execute format(
      'alter table public.audit_logs add constraint %I foreign key (actor_id) references public.profiles(id) on delete set null',
      v_constraint
    );
    raise notice 'audit_logs.% on delete changed to SET NULL', v_constraint;
  end if;
end
$do$;

-- Traceability: known SQL quirks documented (not fixed) for a later migration —
--   1. can_request raises 'Request limit reached.' for the ACTIVE-LOAN cap
--      (should be 'Loan limit reached.' — rules R-09.5) — TS helper owns the
--      user-facing message today; app layer is source of truth.
--   2. can_request/assert_can_request ignore settings.block_on_unpaid_fines
--      (check UNPAID fines unconditionally) while the TS helper honors it.
--      Divergence only if an admin flips that setting to false.
