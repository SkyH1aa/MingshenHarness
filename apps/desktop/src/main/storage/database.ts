import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATION_OFFICE_DELIVERY } from "../../shared/office-delivery";
import { MIGRATION_RUNTIME_V11 } from "../runtime/runtime-service";
import { PLAN_CLAIMS_MIGRATION_SQL } from "../workbench/plan-claim-schema";

export const DATABASE_SCHEMA_VERSION = 11;
export const PRE_V11_BACKUP_MARKER = ".pre-v11-backup-";

const MIGRATION_V1 = `
  create table if not exists secrets (
    id text primary key,
    ciphertext blob not null,
    created_at text not null
  );

  create table if not exists providers (
    id text primary key,
    name text not null,
    base_url text not null,
    protocol text not null check (
      protocol in ('anthropic_messages', 'openai_responses', 'openai_chat_completions')
    ),
    auth_mode text not null check (
      auth_mode in ('bearer', 'x_api_key', 'api_key', 'custom')
    ),
    custom_header_name text,
    active_key_id text,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists provider_keys (
    id text primary key,
    provider_id text not null references providers(id) on delete cascade,
    label text not null,
    secret_ref text not null references secrets(id),
    masked_hint text not null,
    enabled integer not null default 1 check (enabled in (0, 1)),
    priority integer not null default 0,
    never_reveal integer not null default 0 check (never_reveal in (0, 1)),
    cooldown_until text,
    created_at text not null
  );

  create index if not exists provider_keys_provider_idx
    on provider_keys(provider_id, priority);

  create table if not exists models (
    id text primary key,
    provider_id text not null references providers(id) on delete cascade,
    model_id text not null,
    display_name text not null,
    context_window integer not null check (context_window > 0),
    max_output_tokens integer not null check (max_output_tokens > 0),
    input_modalities text not null,
    output_modalities text not null,
    tool_calls integer not null default 1 check (tool_calls in (0, 1)),
    parallel_tool_calls integer not null default 1 check (parallel_tool_calls in (0, 1)),
    reasoning_levels text not null,
    anthropic_none_behavior text not null default 'disabled' check (
      anthropic_none_behavior in ('disabled', 'between_tools', 'reject')
    ),
    enabled integer not null default 1 check (enabled in (0, 1)),
    created_at text not null,
    updated_at text not null,
    unique(provider_id, model_id)
  );

  create index if not exists models_provider_idx
    on models(provider_id);

  create table if not exists sessions (
    id text primary key,
    title text not null,
    provider_id text,
    model_id text,
    workspace_path text,
    system_prompt text not null default '',
    reasoning_level text,
    permission_mode text not null check (
      permission_mode in ('request_approval', 'full_access')
    ),
    status text not null default 'idle' check (
      status in ('idle', 'running', 'waiting_approval', 'interrupted', 'error')
    ),
    archived integer not null default 0 check (archived in (0, 1)),
    pinned integer not null default 0 check (pinned in (0, 1)),
    created_at text not null,
    updated_at text not null,
    last_opened_at text not null
  );

  create index if not exists sessions_updated_idx
    on sessions(archived, updated_at desc);

  create table if not exists messages (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    seq integer not null,
    role text not null check (role in ('user', 'assistant', 'tool')),
    parts_json text not null,
    created_at text not null,
    unique(session_id, seq)
  );

  create index if not exists messages_session_idx
    on messages(session_id, seq);

  create table if not exists app_settings (
    key text primary key,
    value_json text not null,
    updated_at text not null
  );
`;

const MIGRATION_V2 = `
  create table if not exists agent_extensions (
    id text primary key,
    type text not null check (type in ('skill', 'plugin')),
    name text not null,
    description text not null default '',
    source_path text not null,
    installed_path text not null,
    manifest_json text not null default '{}',
    content_hash text not null,
    enabled integer not null default 1 check (enabled in (0, 1)),
    created_at text not null,
    unique(type, content_hash)
  );

  create table if not exists session_extensions (
    session_id text not null references sessions(id) on delete cascade,
    extension_id text not null references agent_extensions(id) on delete cascade,
    enabled integer not null default 1 check (enabled in (0, 1)),
    primary key (session_id, extension_id)
  );

  create table if not exists scheduled_tasks (
    id text primary key,
    name text not null,
    prompt text not null,
    session_id text not null references sessions(id) on delete cascade,
    interval_minutes integer not null check (interval_minutes between 1 and 10080),
    enabled integer not null default 1 check (enabled in (0, 1)),
    last_run_at text,
    next_run_at text not null,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists scheduled_tasks_due_idx
    on scheduled_tasks(enabled, next_run_at);
`;

const MIGRATION_V3 = `
  create table if not exists mcp_servers (
    id text primary key,
    name text not null,
    description text not null default '',
    transport text not null check (transport in ('stdio', 'http')),
    command text not null default '',
    args_json text not null default '[]',
    url text not null default '',
    enabled integer not null default 0 check (enabled in (0, 1)),
    builtin integer not null default 0 check (builtin in (0, 1)),
    header_keys_json text not null default '[]',
    env_keys_json text not null default '[]',
    secret_ref text references secrets(id),
    status text not null default 'disconnected' check (
      status in ('disconnected', 'connected', 'error')
    ),
    tools_json text not null default '[]',
    last_error text,
    last_connected_at text,
    created_at text not null,
    updated_at text not null
  );
`;

const MIGRATION_V4 = `
  alter table sessions add column agent_profile_id text not null default 'primary';
  alter table sessions add column execution_mode text not null default 'host'
    check (execution_mode in ('host', 'worktree', 'docker'));
  alter table sessions add column patch_only integer not null default 0
    check (patch_only in (0, 1));

  create table if not exists agent_profiles (
    id text primary key,
    name text not null,
    description text not null default '',
    role text not null check (role in ('primary', 'plan', 'subagent')),
    instructions text not null default '',
    model_id text,
    read_only integer not null default 0 check (read_only in (0, 1)),
    builtin integer not null default 0 check (builtin in (0, 1)),
    enabled integer not null default 1 check (enabled in (0, 1)),
    created_at text not null,
    updated_at text not null
  );

  insert or ignore into agent_profiles (
    id, name, description, role, instructions, model_id, read_only,
    builtin, enabled, created_at, updated_at
  ) values
    (
      'primary',
      'Mingshen',
      '默认执行 Agent，可读取、编辑、运行命令和调用工具。',
      'primary',
      '',
      null,
      0,
      1,
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    ),
    (
      'plan',
      'Plan',
      '只读规划 Agent，先调查代码与约束，再输出可执行计划，不修改文件。',
      'plan',
      'You are the read-only planning agent. Inspect available evidence, identify risks and dependencies, and return a concrete implementation plan. Do not modify files or system state.',
      null,
      1,
      1,
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );

  create table if not exists project_trust (
    path text primary key,
    trusted integer not null check (trusted in (0, 1)),
    updated_at text not null
  );

  create table if not exists trajectories (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    run_id text not null,
    sequence integer not null,
    type text not null,
    summary text not null,
    payload_json text not null,
    created_at text not null,
    unique(run_id, sequence)
  );

  create index if not exists trajectories_session_idx
    on trajectories(session_id, created_at desc);

  create index if not exists trajectories_run_idx
    on trajectories(run_id, sequence);
`;

const MIGRATION_V5 = `
  alter table sessions add column parent_session_id text;
  alter table sessions add column forked_from_message_id text;

  create index if not exists sessions_parent_idx
    on sessions(parent_session_id, created_at asc);

  alter table agent_profiles add column hidden integer not null default 0
    check (hidden in (0, 1));
  alter table agent_profiles add column source_path text;
  alter table agent_profiles add column content_hash text;
  alter table agent_profiles add column permissions_json text not null default '{}';
  alter table agent_profiles add column tool_allowlist_json text not null default '[]';
  alter table agent_profiles add column temperature real;
  alter table agent_profiles add column top_p real;
  alter table agent_profiles add column max_steps integer;
  alter table agent_profiles add column color text;

  alter table mcp_servers add column cwd text not null default '';
  alter table mcp_servers add column timeout_ms integer not null default 30000
    check (timeout_ms between 1000 and 600000);

  insert or ignore into agent_profiles (
    id, name, description, role, instructions, model_id, read_only,
    builtin, enabled, created_at, updated_at
  ) values
    (
      'general',
      'General',
      '通用子 Agent，适合复杂检索和多步骤任务。',
      'subagent',
      'You are a general-purpose subagent. Complete the assigned task, use tools when available, and report concise findings with evidence.',
      null,
      0,
      1,
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    ),
    (
      'explore',
      'Explore',
      '快速只读探索代码库的子 Agent。',
      'subagent',
      'You are a read-only exploration subagent. Search and inspect the codebase, then return concise evidence and relevant paths.',
      null,
      1,
      1,
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );

  create unique index if not exists agent_profiles_source_path_unique
    on agent_profiles(source_path)
    where source_path is not null;

  create table if not exists session_todos (
    session_id text not null references sessions(id) on delete cascade,
    id text not null,
    content text not null,
    status text not null check (
      status in ('pending', 'in_progress', 'completed', 'cancelled')
    ),
    priority text not null check (priority in ('high', 'medium', 'low')),
    updated_at text not null,
    primary key (session_id, id)
  );

  create index if not exists session_todos_status_idx
    on session_todos(session_id, status, priority);
`;

const MIGRATION_V6 = `
  create table agent_profiles_v6 (
    id text primary key,
    name text not null,
    description text not null default '',
    role text not null check (role in ('primary', 'plan', 'subagent', 'all')),
    instructions text not null default '',
    model_id text,
    read_only integer not null default 0 check (read_only in (0, 1)),
    builtin integer not null default 0 check (builtin in (0, 1)),
    enabled integer not null default 1 check (enabled in (0, 1)),
    created_at text not null,
    updated_at text not null,
    hidden integer not null default 0 check (hidden in (0, 1)),
    source_path text,
    content_hash text,
    permissions_json text not null default '{}',
    tool_allowlist_json text not null default '[]',
    temperature real,
    top_p real,
    max_steps integer,
    color text
  );

  insert into agent_profiles_v6 (
    id, name, description, role, instructions, model_id, read_only, builtin,
    enabled, created_at, updated_at, hidden, source_path, content_hash,
    permissions_json, tool_allowlist_json, temperature, top_p, max_steps, color
  )
  select
    id, name, description, role, instructions, model_id, read_only, builtin,
    enabled, created_at, updated_at, hidden, source_path, content_hash,
    permissions_json, tool_allowlist_json, temperature, top_p, max_steps, color
  from agent_profiles;

  drop table agent_profiles;
  alter table agent_profiles_v6 rename to agent_profiles;

  create unique index if not exists agent_profiles_source_path_unique
    on agent_profiles(source_path)
    where source_path is not null;
`;

const MIGRATION_V7 = `
  create index sessions_catalog_idx on sessions(archived, parent_session_id, pinned desc, max(last_opened_at, updated_at, created_at) desc, id);
  create index sessions_workspace_catalog_idx on sessions(workspace_path, archived, parent_session_id);
  create virtual table session_title_search using fts5(title, content='sessions', content_rowid='rowid', tokenize='trigram');
  insert into session_title_search(session_title_search) values('rebuild');
  create table session_changes(seq integer primary key autoincrement, session_id text not null, removed integer not null);
  create trigger sessions_catalog_insert after insert on sessions begin
    insert into session_title_search(rowid,title) values(new.rowid,new.title);
    insert into session_changes(session_id,removed) values(new.id,0);
    delete from session_changes where seq < (select max(seq)-20000 from session_changes);
  end;
  create trigger sessions_catalog_update after update on sessions begin
    insert into session_title_search(session_title_search,rowid,title) values('delete',old.rowid,old.title);
    insert into session_title_search(rowid,title) values(new.rowid,new.title);
    insert into session_changes(session_id,removed) values(new.id,0);
    delete from session_changes where seq < (select max(seq)-20000 from session_changes);
  end;
  create trigger sessions_catalog_delete after delete on sessions begin
    insert into session_title_search(session_title_search,rowid,title) values('delete',old.rowid,old.title);
    insert into session_changes(session_id,removed) values(old.id,1);
    delete from session_changes where seq < (select max(seq)-20000 from session_changes);
  end;
`;

const MIGRATION_V8 = `
  create table providers_v8 (
    id text primary key,
    name text not null,
    base_url text not null,
    protocol text not null check (
      protocol in ('anthropic_messages', 'openai_responses', 'openai_chat_completions', 'gemini_generate_content')
    ),
    auth_mode text not null check (
      auth_mode in ('bearer', 'x_api_key', 'api_key', 'x_goog_api_key', 'custom')
    ),
    custom_header_name text,
    active_key_id text,
    created_at text not null,
    updated_at text not null
  );
  insert into providers_v8 select * from providers;
  drop table providers;
  alter table providers_v8 rename to providers;
`;

const MIGRATION_V9 = `
  alter table sessions add column agent_mode text not null default 'code'
    check (agent_mode in ('code', 'work', 'chat'));

  create table if not exists chat_groups (
    id text primary key,
    name text not null,
    created_at text not null,
    updated_at text not null
  );

  alter table sessions add column chat_group_id text
    references chat_groups(id) on delete set null;

  create index if not exists sessions_agent_mode_catalog_idx
    on sessions(agent_mode, archived, chat_group_id, pinned desc, updated_at desc);

  alter table agent_profiles add column applicable_modes_json text not null
    default '["code","work"]';
`;

const MIGRATION_V10 = `
  create table providers_v10 (
    id text primary key,
    name text not null,
    base_url text not null,
    protocol text not null check (
      protocol in ('anthropic_messages', 'openai_responses', 'openai_chat_completions', 'gemini_generate_content', 'openai_images')
    ),
    auth_mode text not null check (
      auth_mode in ('bearer', 'x_api_key', 'api_key', 'x_goog_api_key', 'custom')
    ),
    custom_header_name text,
    active_key_id text,
    created_at text not null,
    updated_at text not null
  );
  insert into providers_v10 select * from providers;
  drop table providers;
  alter table providers_v10 rename to providers;
`;

const MIGRATION_V11 = `
  ${MIGRATION_RUNTIME_V11}
  ${PLAN_CLAIMS_MIGRATION_SQL}
  ${MIGRATION_OFFICE_DELIVERY}
`;

// Keep every historical step in the application; upgrades may skip many releases.
export const DATABASE_MIGRATIONS: readonly string[] = [
  MIGRATION_V1,
  MIGRATION_V2,
  MIGRATION_V3,
  MIGRATION_V4,
  MIGRATION_V5,
  MIGRATION_V6,
  MIGRATION_V7,
  MIGRATION_V8,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V11,
];

function isMemoryDatabase(filePath: string): boolean {
  return (
    filePath === ":memory:" ||
    filePath.startsWith("file::memory:") ||
    /[?&]mode=memory(?:&|$)/i.test(filePath)
  );
}

function createPreV11Backup(database: DatabaseSync, filePath: string): string | null {
  if (isMemoryDatabase(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}${PRE_V11_BACKUP_MARKER}${timestamp}-${randomUUID()}.sqlite`;
  database.prepare("vacuum into ?").run(backupPath);
  return backupPath;
}

export function openDatabase(filePath: string): DatabaseSync {
  if (!isMemoryDatabase(filePath)) mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  try {
    database.exec("pragma journal_mode = wal;");
    database.exec("pragma foreign_keys = on;");
    database.exec("pragma busy_timeout = 5000;");

    const versionRow = database.prepare("pragma user_version;").get() as
      | { user_version: number }
      | undefined;
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion > DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `Database schema ${currentVersion} is newer than the supported version ${DATABASE_SCHEMA_VERSION}.`,
      );
    }

    for (let version = currentVersion + 1; version <= DATABASE_SCHEMA_VERSION; version++) {
      if (version === 11 && currentVersion > 0) createPreV11Backup(database, filePath);
      // Rebuild the parent without cascading deletes or rewriting child FK targets.
      const rebuildsProviders = version === 8 || version === 10;
      if (rebuildsProviders) database.exec("pragma foreign_keys = off;");
      let transactionOpen = false;
      try {
        database.exec("begin immediate;");
        transactionOpen = true;
        const migration = DATABASE_MIGRATIONS[version - 1];
        if (!migration) throw new Error(`Missing database migration ${version}.`);
        database.exec(migration);
        if (rebuildsProviders && database.prepare("pragma foreign_key_check;").all().length)
          throw new Error("Provider migration failed foreign key validation.");
        database.exec(`pragma user_version = ${version};`);
        database.exec("commit;");
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) database.exec("rollback;");
        throw error;
      } finally {
        if (rebuildsProviders) database.exec("pragma foreign_keys = on;");
      }
    }
    return database;
  } catch (cause) {
    database.close();
    throw cause;
  }
}
