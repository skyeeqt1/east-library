-- =============================================================================
-- 0003_cron.sql — schedule the daily overdue sweep — R-18
-- Source of truth: schema.md §7.2 (daily overdue job), §8 (checklist)
-- Depends on: 0002_functions.sql → public.run_overdue_sweep()
--
-- Idempotency: pg_cron has no DDL you can `drop procedure if exists`, so we
-- make cron.schedule idempotent the pg_cron way: find the stable job name
-- 'overdue-sweep' in cron.job and cron.unschedule() it first, then schedule
-- it again. Re-running this file never creates duplicate jobs.
--
-- =============================================================================
-- TIMEZONE MATH (read before ever editing the cron expression)
-- -----------------------------------------------------------------------------
-- Requirement (R-18): the sweep runs daily at 00:05 Asia/Manila.
-- Supabase's pg_cron evaluates EVERY schedule in UTC — there is no timezone
-- argument, and Manila has no DST (UTC+8 year-round).
--
--     00:05 Asia/Manila on day D  =  16:05 UTC on day D-1
--
-- so the job must fire at 16:05 UTC the PREVIOUS calendar day:
--
--     cron expression = '5 16 * * *'
--
-- Example: fires 16:05 UTC on 2026-01-01 → it is already 00:05 on
-- 2026-01-02 in Manila. Do NOT use '5 0 * * *' — that is 08:05 Manila
-- (schema.md §7.2 shows that expression as a snippet; this migration is
-- the corrected, scheduled version).
-- =============================================================================

do $do$
declare
  v_pg_cron  integer;
  v_job_id   bigint;
begin
  -- 1. Is pg_cron installed at all?
  select count(*)
    into v_pg_cron
    from pg_extension
   where extname = 'pg_cron';

  if v_pg_cron = 0 then
    -- No error: notice only, so the migration still succeeds on projects
    -- where an operator has not enabled pg_cron yet (R-18 manual fallback).
    raise notice 'pg_cron is NOT installed — job "overdue-sweep" NOT scheduled (R-18).';
    raise notice 'Manual setup: (1) Supabase Dashboard > Database > Extensions > search "pg_cron" > Enable (local CLI: create extension if not exists pg_cron; run as superuser). (2) Re-run 0003_cron.sql. The sweep will then run daily at 00:05 Asia/Manila (16:05 UTC previous day).';
  else
    -- 2. Unschedule any previous job with this stable name (idempotency)
    select jobid
      into v_job_id
      from cron.job
     where jobname = 'overdue-sweep';

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    -- 3. (Re)schedule: 16:05 UTC daily = 00:05 Asia/Manila next day (R-18)
    perform cron.schedule(
      'overdue-sweep',   -- stable job name, reused for unschedule above
      '5 16 * * *',      -- 16:05 UTC previous day = 00:05 Asia/Manila
      $$select public.run_overdue_sweep()$$
    );

    raise notice 'overdue-sweep scheduled: daily 16:05 UTC = 00:05 Asia/Manila (R-18).';
  end if;
end
$do$;
