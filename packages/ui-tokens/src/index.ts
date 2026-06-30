export type TangentTokenGroups = {
  color: Record<
    | "bg"
    | "surface"
    | "surfaceRaised"
    | "surfaceInset"
    | "text"
    | "textMuted"
    | "border"
    | "accent"
    | "success"
    | "warning"
    | "danger"
    | "info"
    | "diffAdd"
    | "diffDelete"
    | "code"
    | "chart",
    string
  >;
  spacing: Record<"0" | "1" | "2" | "3" | "4" | "5" | "6" | "8" | "10" | "12" | "16", string>;
  radius: Record<"none" | "sm" | "md" | "lg" | "xl" | "pill", string>;
  typography: {
    fontSans: string;
    fontMono: string;
    textXs: string;
    textSm: string;
    textMd: string;
    textLg: string;
    titleSm: string;
    titleMd: string;
    titleLg: string;
  };
  density: Record<"compact" | "comfortable" | "spacious", { controlHeight: string; rowHeight: string; gap: string }>;
  motion: {
    durationFast: string;
    durationNormal: string;
    easingStandard: string;
  };
};

export const tangentTokens: TangentTokenGroups = {
  color: {
    bg: "var(--tangent-color-bg)",
    surface: "var(--tangent-color-surface)",
    surfaceRaised: "var(--tangent-color-surface-raised)",
    surfaceInset: "var(--tangent-color-surface-inset)",
    text: "var(--tangent-color-text)",
    textMuted: "var(--tangent-color-text-muted)",
    border: "var(--tangent-color-border)",
    accent: "var(--tangent-color-accent)",
    success: "var(--tangent-color-success)",
    warning: "var(--tangent-color-warning)",
    danger: "var(--tangent-color-danger)",
    info: "var(--tangent-color-info)",
    diffAdd: "var(--tangent-color-diff-add)",
    diffDelete: "var(--tangent-color-diff-delete)",
    code: "var(--tangent-color-code)",
    chart: "var(--tangent-color-chart)"
  },
  spacing: {
    "0": "0",
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "8": "2rem",
    "10": "2.5rem",
    "12": "3rem",
    "16": "4rem"
  },
  radius: {
    none: "0",
    sm: "0.25rem",
    md: "0.375rem",
    lg: "0.5rem",
    xl: "0.75rem",
    pill: "999px"
  },
  typography: {
    fontSans: "var(--tangent-font-sans)",
    fontMono: "var(--tangent-font-mono)",
    textXs: "var(--tangent-text-xs)",
    textSm: "var(--tangent-text-sm)",
    textMd: "var(--tangent-text-md)",
    textLg: "var(--tangent-text-lg)",
    titleSm: "var(--tangent-title-sm)",
    titleMd: "var(--tangent-title-md)",
    titleLg: "var(--tangent-title-lg)"
  },
  density: {
    compact: { controlHeight: "28px", rowHeight: "32px", gap: "0.375rem" },
    comfortable: { controlHeight: "34px", rowHeight: "40px", gap: "0.5rem" },
    spacious: { controlHeight: "40px", rowHeight: "48px", gap: "0.75rem" }
  },
  motion: {
    durationFast: "120ms",
    durationNormal: "180ms",
    easingStandard: "cubic-bezier(0.2, 0, 0, 1)"
  }
};
