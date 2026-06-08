export type EvalContextMode =
  | { mode: "repo" }
  | { mode: "empty" }
  | { mode: "snapshot"; ref: string }
  | { mode: "git-ref"; ref: string };

export type EvalContextFileScope = "repo" | "ancestor";

export type EvalContextFile = {
  scope: EvalContextFileScope;
  depth?: number;
  path: string;
  snapshotPath: string;
  sha256: string;
};

export type EvalContextManifest = {
  schema: "eval.context.v1";
  id: string;
  createdAt: string;
  source: {
    repoRoot: string;
    repoHead?: string;
    cwd: string;
    ref?: string;
    empty?: boolean;
    dirtyContextIncluded?: boolean;
  };
  discovery: {
    cwd: string;
    includeAncestors: boolean;
    patterns: string[];
  };
  files: EvalContextFile[];
};

export const contextPatterns = [
  "CLAUDE.md",
  "AGENT.md",
  "AGENTS.md",
  ".claude/**",
  ".agents/**",
  ".agnets/**"
];
