export type EvalAgentConfig =
  | { kind: "manual" }
  | {
      kind: "codex-cli";
      command?: string;
      model: string;
      profile?: string;
      sandbox: "read-only" | "workspace-write" | "danger-full-access";
      timeoutMs?: number;
    }
  | {
      kind: "claude-cli";
      command?: string;
      model: string;
      permissionMode?: string;
      maxTurns?: number;
      timeoutMs?: number;
    };
