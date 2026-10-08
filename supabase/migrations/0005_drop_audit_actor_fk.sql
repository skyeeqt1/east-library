-- =============================================================================
-- 0005_drop_audit_actor_fk.sql — audit_logs.actor_id must NOT be a FK
--
-- Follow-up to 0004. Root cause of the failed deletion (found via live test):
-- audit_logs is protected by append-only RULEs (audit_no_update / audit_no_delete,
-- 0001_init.sql). ON DELETE SET NULL requires the FK trigger to UPDATE audit_logs,
-- but the update RULE intercepts it and does nothing -> the RI trigger sees 0
-- rows updated -> error XX000 "referential integrity query ... gave unexpected
-- result". Rules and self-maintaining FKs are fundamentally incompatible here.
--
-- Design decision: an append-only audit/event log should not enforce live
-- references. actor_id becomes a plain uuid snapshot of who did it; when the
-- account is deleted the uuid remains as a historical trace (like storing the
-- name). The audit still records everything (R-32); account deletion (R-06)
-- now works.
-- =============================================================================

alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;

comment on column public.audit_logs.actor_id is
  'Actor uuid snapshot (NOT a FK — audit is append-only; deleted accounts leave their uuid as history).';
