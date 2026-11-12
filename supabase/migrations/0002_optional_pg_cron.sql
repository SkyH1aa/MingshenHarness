-- Optional: configure daily retention cleanup with pg_cron.
-- Run only after 0001_init.sql succeeds and pg_cron is available in the project.
-- If your Supabase plan or permission model does not allow pg_cron, keep the
-- application-level cleanup and run mingshen_purge_expired_diagnostics manually as needed.

begin;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'mingshen-purge-diagnostics',
  '17 3 * * *',
  $$select public.mingshen_purge_expired_diagnostics();$$
);

commit;
