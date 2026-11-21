import { describe, expect, it } from "vitest";
import { CREATIVE_TEMPLATES } from "../../shared/creative-templates";
import { DOMAIN_SKILLS } from "./domain-skills";

describe("creative template skill bindings", () => {
  it("only recommends registered skills available to WorkAgent", () => {
    const available = new Set(
      DOMAIN_SKILLS.filter((skill) => (skill.modes as readonly string[]).includes("work")).map(
        (skill) => `builtin:${skill.id}`,
      ),
    );
    for (const template of CREATIVE_TEMPLATES) {
      for (const skill of template.recommendedSkills) {
        expect(available.has(skill.id), `${template.id}: ${skill.id}`).toBe(true);
      }
    }
  });
});
