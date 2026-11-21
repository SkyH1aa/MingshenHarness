export type CreativeCategoryId =
  | "presentation"
  | "document"
  | "spreadsheet"
  | "poster"
  | "learning"
  | "planning"
  | "research"
  | "marketing"
  | "product"
  | "engineering"
  | "people"
  | "operations";

export type CreativeFormatId = "PPTX" | "DOCX" | "XLSX" | "PDF" | "HTML";

export type CreativeTranslation = readonly [zh: string, en: string];

export type CreativeAuthoredSection = readonly [
  id: string,
  title: string,
  titleEn: string,
  intent: string,
  intentEn: string,
];

export interface CreativeAuthoredScenario {
  name: CreativeTranslation;
  audience: CreativeTranslation;
  focus: CreativeTranslation;
  inputs: CreativeTranslation;
  output: CreativeTranslation;
  risk: CreativeTranslation;
  brief?: {
    focus: CreativeTranslation;
    output: CreativeTranslation;
    risk: CreativeTranslation;
  };
  tags?: readonly string[];
}

export interface CreativeExtendedFamily {
  id: string;
  name: CreativeTranslation;
  category: CreativeCategoryId;
  format: CreativeFormatId;
  summary: CreativeTranslation;
  style: CreativeTranslation;
  sections: readonly CreativeAuthoredSection[];
  acceptance: readonly CreativeTranslation[];
  workflow: readonly CreativeTranslation[];
  playbook: {
    inputs: CreativeTranslation;
    method: CreativeTranslation;
    design: CreativeTranslation;
    checks: CreativeTranslation;
  };
  scenarios: readonly CreativeAuthoredScenario[];
}
