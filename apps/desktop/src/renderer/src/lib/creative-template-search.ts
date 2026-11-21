import {
  type CreativeTemplate,
  type CreativeTemplateCategory,
  type CreativeTemplateFormat,
  creativeCategoryLabel,
} from "../../../shared/creative-templates";

export interface CreativeTemplateSearchEntry {
  template: CreativeTemplate;
  text: string;
}

function normalize(value: string, locale: "zh-CN" | "en"): string {
  return value.normalize("NFKC").toLocaleLowerCase(locale);
}

export function indexCreativeTemplates(
  templates: readonly CreativeTemplate[],
  locale: "zh-CN" | "en",
): CreativeTemplateSearchEntry[] {
  return templates.map((template) => ({
    template,
    text: normalize(
      [
        template.id,
        template.name,
        template.nameEn,
        template.summary,
        template.summaryEn,
        template.detailedDescription,
        template.detailedDescriptionEn,
        template.defaultAudience,
        template.defaultAudienceEn,
        template.format,
        template.category,
        creativeCategoryLabel(template.category, "zh-CN"),
        creativeCategoryLabel(template.category, "en"),
        ...template.tags,
        ...template.sections.flatMap((section) => [
          section.title,
          section.titleEn,
          section.intent,
          section.intentEn,
        ]),
        ...template.recommendedSkills.flatMap((skill) => [
          skill.id,
          skill.name,
          skill.nameEn,
          skill.reason,
          skill.reasonEn,
        ]),
      ].join("\n"),
      locale,
    ),
  }));
}

export function searchCreativeTemplates(
  entries: readonly CreativeTemplateSearchEntry[],
  query: string,
  category: CreativeTemplateCategory | "all",
  format: CreativeTemplateFormat | "all",
  locale: "zh-CN" | "en",
): CreativeTemplate[] {
  const terms = normalize(query.trim(), locale).split(/\s+/u).filter(Boolean);
  return entries
    .filter(({ template, text }) => {
      if (category !== "all" && template.category !== category) return false;
      if (format !== "all" && template.format !== format) return false;
      return terms.every((term) => text.includes(term));
    })
    .map(({ template }) => template);
}
