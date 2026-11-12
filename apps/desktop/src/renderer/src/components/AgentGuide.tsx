import type { AgentProfileView } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { agentDescription, agentLabel } from "../lib/agent-labels";

export function AgentGuide({ profiles }: { profiles: AgentProfileView[] }) {
  return (
    <section className="agent-guide" aria-label={tr("选择适合的 Agent")}>
      <h3>{tr("选择适合的 Agent")}</h3>
      <dl>
        {[...profiles]
          .filter((profile) => profile.enabled)
          .sort((a, b) => {
            const defaults = ["primary", "plan", "general", "explore"];
            const left = defaults.indexOf(a.id);
            const right = defaults.indexOf(b.id);
            return (
              (left < 0 ? defaults.length : left) - (right < 0 ? defaults.length : right) ||
              a.name.localeCompare(b.name)
            );
          })
          .map((profile) => (
            <div key={profile.id}>
              <dt>{agentLabel(profile)}</dt>
              <dd>{agentDescription(profile)}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
