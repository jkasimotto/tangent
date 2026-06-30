export type EvalAgentConfig =
  | { kind: "manual" }
  | {
      kind: "codex-cli";
      command?: string;
      model: string;
      profile?: string;
      sandbox: "read-only" | "workspace-write" | "danger-full-access";
      timeoutMs?: number;
      /** Extra environment for the spawned process, e.g. CLAUDE_CONFIG_DIR to pick a config home/auth. Merged over the inherited process env, under the TANGENT_EVAL_* vars. */
      env?: Record<string, string>;
    }
  | {
      kind: "claude-cli";
      command?: string;
      model: string;
      permissionMode?: string;
      maxTurns?: number;
      timeoutMs?: number;
      /** Extra environment for the spawned process, e.g. CLAUDE_CONFIG_DIR to select which Claude config home (and auth token) the run uses. Merged over the inherited process env, under the TANGENT_EVAL_* vars. */
      env?: Record<string, string>;
    }
  | {
      kind: "gemini-cli";
      command?: string;
      model: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    };
