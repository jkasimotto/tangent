export type HookProvider = "claude" | "codex";

export type HookScope = "global" | "repo-local" | "repo-shared";

export type HookCommandOptions = {
  provider: HookProvider;
  scope: HookScope;
  repoRoot?: string;
  recordCommand?: string;
};

export type HookInstallStatus = {
  installed: boolean;
  path: string;
};
