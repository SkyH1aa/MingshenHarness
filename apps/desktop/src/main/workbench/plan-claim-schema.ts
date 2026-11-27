export const PLAN_CLAIMS_MIGRATION_SQL = `
  create table if not exists plan_generations (
    session_id text primary key references sessions(id) on delete cascade,
    generation integer not null default 1 check (generation > 0),
    updated_at text not null
  );

  create table if not exists plan_step_claims (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    generation integer not null check (generation > 0),
    step_id text not null,
    owner_session_id text not null,
    owner_run_id text not null,
    agent_profile_id text,
    status text not null check (
      status in ('active', 'stale', 'cancel_requested', 'completed', 'released')
    ),
    lease_until text not null,
    heartbeat_at text not null,
    attempt integer not null default 1 check (attempt > 0),
    revision integer not null check (revision >= 0),
    claim_version integer not null default 1 check (claim_version > 0),
    summary text not null default '',
    evidence_json text not null default '[]',
    created_at text not null,
    updated_at text not null,
    completed_at text
  );

  create unique index if not exists plan_step_claims_unresolved_unique
    on plan_step_claims(session_id, generation, step_id)
    where status in ('active', 'stale', 'cancel_requested');

  create index if not exists plan_step_claims_session_idx
    on plan_step_claims(session_id, generation, created_at desc);

  create index if not exists plan_step_claims_owner_idx
    on plan_step_claims(owner_session_id, owner_run_id, status);

  create index if not exists plan_step_claims_lease_idx
    on plan_step_claims(status, lease_until);
`;
