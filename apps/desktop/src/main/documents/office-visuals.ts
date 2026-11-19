export const OFFICE_DESIGN_PRESETS = ["executive", "consulting", "editorial", "minimal"] as const;

export const OFFICE_DESIGN_DENSITIES = ["airy", "balanced", "compact"] as const;

export type OfficeDesignPreset = (typeof OFFICE_DESIGN_PRESETS)[number];
export type OfficeDesignDensity = (typeof OFFICE_DESIGN_DENSITIES)[number];

export interface OfficePalette {
  canvas: string;
  panel: string;
  ink: string;
  muted: string;
  accent: string;
  accentSoft: string;
  secondary: string;
  positive: string;
  warning: string;
  line: string;
  dark: string;
  white: string;
}

export interface ResolvedOfficeVisual {
  preset: OfficeDesignPreset;
  density: OfficeDesignDensity;
  palette: OfficePalette;
  coverPage: boolean;
}

const PALETTES: Record<OfficeDesignPreset, OfficePalette> = {
  executive: {
    canvas: "F5F7F6",
    panel: "FFFFFF",
    ink: "14272E",
    muted: "5B6B70",
    accent: "0F6F78",
    accentSoft: "DDEEEF",
    secondary: "C96445",
    positive: "5E7D55",
    warning: "B7791F",
    line: "D8E1E2",
    dark: "10242B",
    white: "FFFFFF",
  },
  consulting: {
    canvas: "F6F7F9",
    panel: "FFFFFF",
    ink: "17253D",
    muted: "58657A",
    accent: "1F4E78",
    accentSoft: "E8EEF5",
    secondary: "B77A16",
    positive: "3F7D5A",
    warning: "A65E16",
    line: "D7DFE8",
    dark: "15233B",
    white: "FFFFFF",
  },
  editorial: {
    canvas: "FBF8F2",
    panel: "FFFFFF",
    ink: "29231E",
    muted: "6A6057",
    accent: "8B4034",
    accentSoft: "F1E5DB",
    secondary: "2F6D69",
    positive: "647A45",
    warning: "AD6A1E",
    line: "E2D9CF",
    dark: "2A2420",
    white: "FFFFFF",
  },
  minimal: {
    canvas: "F7F8F7",
    panel: "FFFFFF",
    ink: "202524",
    muted: "626B69",
    accent: "16736F",
    accentSoft: "E7EFED",
    secondary: "776F67",
    positive: "4B7855",
    warning: "9A681D",
    line: "DDE3E1",
    dark: "1E2524",
    white: "FFFFFF",
  },
};

export function resolveOfficeVisual(input?: {
  preset?: OfficeDesignPreset | undefined;
  density?: OfficeDesignDensity | undefined;
  accent?: string | undefined;
  coverPage?: boolean | undefined;
}): ResolvedOfficeVisual {
  const preset = input?.preset ?? "executive";
  const palette = { ...PALETTES[preset] };
  if (input?.accent) palette.accent = normalizeHexColor(input.accent);
  return {
    preset,
    density: input?.density ?? "balanced",
    palette,
    coverPage: input?.coverPage ?? false,
  };
}

export function officePaletteCss(palette: OfficePalette): Record<string, string> {
  return Object.fromEntries(Object.entries(palette).map(([name, value]) => [name, `#${value}`]));
}

function normalizeHexColor(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}
