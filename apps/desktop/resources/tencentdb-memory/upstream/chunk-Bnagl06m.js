// ../../third_party/tencentdb-agent-memory/src/core/store/isolation.ts
/**
* Isolation Context — three-dimensional tenancy for L0/L1/Profile data.
*
* Every write into L0_conversations / l1_records / profiles MUST carry a
* full IsolationContext (user_id, agent_id, session_id). Every query MUST
* accept an IsolationFilter so the caller controls which dimensions are
* narrowed.
*
* See `docs/l0l3-tenant-isolation-design.md` for the full design rationale.
*/
/** Default bucket used when caller does not provide explicit isolation fields. */
const DEFAULT_ISOLATION_ID = "default";
/**
* Check whether a row honours an IsolationFilter (post-retrieve re-check).
* Used as a safety net after vector / FTS recall, in case the underlying
* store cannot push the filter down (e.g. older TCVDB collection).
*/
function rowMatchesIsolation(row, filter) {
	if (!filter) return true;
	if (filter.teamId !== void 0 && row.team_id !== filter.teamId) return false;
	if (filter.userId !== void 0 && row.user_id !== filter.userId) return false;
	if (filter.agentId !== void 0 && row.agent_id !== filter.agentId) return false;
	if (filter.sessionId !== void 0 && row.session_id !== filter.sessionId) return false;
	if (filter.taskId !== void 0 && row.task_id !== filter.taskId) return false;
	if (filter.sessionKey !== void 0 && row.session_key !== filter.sessionKey) return false;
	return true;
}
export { rowMatchesIsolation as n, DEFAULT_ISOLATION_ID as t };
