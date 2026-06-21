import type {
  ActionModel,
  AgentCapabilities,
  AgentCommandSpec,
  BuildAgentCommandInput,
  PermissionRequest,
  TreeObservation
} from "@tangent/trees-schema";

export interface TreeAgentAdapter {
  id: string;
  displayName: string;
  capabilities(): AgentCapabilities;
  buildCommand(input: BuildAgentCommandInput): Promise<AgentCommandSpec> | AgentCommandSpec;
  parseObservation?(input: AgentObservationInput): Promise<TreeObservation[]> | TreeObservation[];
  permissionActions?(request: PermissionRequest): ActionModel[];
}

export type AgentObservationInput = {
  text: string;
  observedAt: string;
  agentRunId: string;
  entityId?: string;
  terminalSessionId?: string;
};

export type CustomCommandAdapterOptions = {
  id?: string;
  displayName?: string;
  command: string;
  args?: string[];
};

/** Documents the createBuiltInAgentAdapters helper. */
export function createBuiltInAgentAdapters(customCommand?: CustomCommandAdapterOptions): TreeAgentAdapter[] {
  return [
    createManualAgentAdapter(),
    createCodexCliAgentAdapter(),
    createClaudeCliAgentAdapter(),
    createGeminiCliAgentAdapter(),
    createCustomCommandAgentAdapter(customCommand || { command: "sh", args: ["-lc", "$TANGENT_CUSTOM_AGENT_COMMAND"] })
  ];
}

/** Documents the findAgentAdapter helper. */
export function findAgentAdapter(adapters: TreeAgentAdapter[], id = "codex-cli"): TreeAgentAdapter {
  const adapter = adapters.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`Unknown Trees agent adapter: ${id}`);
  return adapter;
}

/** Documents the createManualAgentAdapter helper. */
export function createManualAgentAdapter(): TreeAgentAdapter {
  return {
    id: "manual",
    displayName: "Manual",
    /** Documents the capabilities helper. */
    capabilities: () => ({ supportsPrompt: false, supportsModel: false, supportsSandbox: false, supportsPermissionActions: false }),
    /** Documents the buildCommand helper. */
    buildCommand(input) {
      return {
        command: "sh",
        args: ["-lc", "echo 'Manual Trees agent run recorded. Attach a terminal or send instructions manually.'; sleep 1"],
        cwd: input.cwd,
        env: input.env
      };
    }
  };
}

/** Documents the createCustomCommandAgentAdapter helper. */
export function createCustomCommandAgentAdapter(options: CustomCommandAdapterOptions): TreeAgentAdapter {
  return {
    id: options.id || "custom-command",
    displayName: options.displayName || "Custom command",
    /** Documents the capabilities helper. */
    capabilities: () => ({ supportsPrompt: true, supportsModel: false, supportsSandbox: false, supportsPermissionActions: false }),
    /** Documents the buildCommand helper. */
    buildCommand(input) {
      return {
        command: options.command,
        args: interpolateArgs(options.args || [], input),
        cwd: input.cwd,
        env: input.env,
        stdin: input.prompt
      };
    }
  };
}

/** Documents the createCodexCliAgentAdapter helper. */
export function createCodexCliAgentAdapter(): TreeAgentAdapter {
  return {
    id: "codex-cli",
    displayName: "Codex CLI",
    /** Documents the capabilities helper. */
    capabilities: () => ({ supportsPrompt: true, supportsModel: true, supportsSandbox: true, supportsPermissionActions: true }),
    /** Documents the buildCommand helper. */
    buildCommand(input) {
      const args = ["exec"];
      if (input.model) args.push("--model", input.model);
      if (input.sandbox) args.push("--sandbox", input.sandbox);
      if (input.prompt) args.push(input.prompt);
      return { command: "codex", args, cwd: input.cwd, env: input.env };
    },
    parseObservation: parseCommonAgentOutput,
    permissionActions: defaultPermissionActions
  };
}

/** Documents the createClaudeCliAgentAdapter helper. */
export function createClaudeCliAgentAdapter(): TreeAgentAdapter {
  return {
    id: "claude-cli",
    displayName: "Claude CLI",
    /** Documents the capabilities helper. */
    capabilities: () => ({ supportsPrompt: true, supportsModel: true, supportsSandbox: false, supportsPermissionActions: true }),
    /** Documents the buildCommand helper. */
    buildCommand(input) {
      const args = [];
      if (input.model) args.push("--model", input.model);
      if (input.prompt) args.push("-p", input.prompt);
      return { command: "claude", args, cwd: input.cwd, env: input.env };
    },
    parseObservation: parseCommonAgentOutput,
    permissionActions: defaultPermissionActions
  };
}

/** Documents the createGeminiCliAgentAdapter helper. */
export function createGeminiCliAgentAdapter(): TreeAgentAdapter {
  return {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    /** Documents the capabilities helper. */
    capabilities: () => ({ supportsPrompt: true, supportsModel: true, supportsSandbox: false, supportsPermissionActions: false }),
    /** Documents the buildCommand helper. */
    buildCommand(input) {
      const args = [];
      if (input.model) args.push("--model", input.model);
      if (input.prompt) args.push("--prompt", input.prompt);
      return { command: "gemini", args, cwd: input.cwd, env: input.env };
    },
    parseObservation: parseCommonAgentOutput
  };
}

/** Documents the buildTreesAgentEnv helper. */
export function buildTreesAgentEnv(input: {
  entityId: string;
  entityPath: string;
  workSessionId?: string;
  agentRunId: string;
  terminalSessionId?: string;
  worktreePath?: string;
  repoRoot?: string;
  provider?: string;
  adapterId: string;
  baseEnv?: Record<string, string>;
}): Record<string, string> {
  return compactEnv({
    ...input.baseEnv,
    TANGENT_TREE_ENTITY_ID: input.entityId,
    TANGENT_TREE_ENTITY_PATH: input.entityPath,
    TANGENT_WORK_SESSION_ID: input.workSessionId,
    TANGENT_AGENT_RUN_ID: input.agentRunId,
    TANGENT_TERMINAL_SESSION_ID: input.terminalSessionId,
    TANGENT_WORKTREE: input.worktreePath,
    TANGENT_REPO_ROOT: input.repoRoot,
    TANGENT_PROVIDER: input.provider,
    TANGENT_AGENT_ADAPTER: input.adapterId
  });
}

/** Parses common agent terminal output into observations (permission requested, done, failed). Used by the notify watcher to read a captured tmux pane. */
export function parseCommonAgentOutput(input: AgentObservationInput): TreeObservation[] {
  const lower = input.text.toLowerCase();
  if (!/(permission|approve|deny|failed|error|done|complete)/.test(lower)) return [];
  const kind = lower.includes("permission") || lower.includes("approve") ? "agent.permission_requested" : lower.includes("failed") || lower.includes("error") ? "agent.status" : "agent.status";
  const status = lower.includes("failed") || lower.includes("error") ? "failed" : lower.includes("done") || lower.includes("complete") ? "done" : undefined;
  return [{
    schema: "tangent.trees.observation.v1",
    id: `obs_${input.agentRunId}_${Math.abs(hash(input.text))}`,
    observedAt: input.observedAt,
    recordedAt: input.observedAt,
    source: { id: "agent-output-parser", kind: "agent-adapter", adapterId: "common-output" },
    subject: { entityId: input.entityId, agentRunId: input.agentRunId, terminalSessionId: input.terminalSessionId },
    kind,
    data: { text: input.text, status, permissionRequestId: kind === "agent.permission_requested" ? `perm_${Math.abs(hash(input.text))}` : undefined },
    confidence: "adapter-parsed",
    evidence: [{ id: `evidence_${input.agentRunId}_${Math.abs(hash(input.text))}`, kind: "terminal-output", text: input.text }]
  }];
}

/** Documents the defaultPermissionActions helper. */
function defaultPermissionActions(request: PermissionRequest): ActionModel[] {
  return ["Approve", "Deny", "Send instruction", "Open terminal", "View evidence"].map((label) => ({
    id: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    kind: "ui-action",
    input: { permissionRequestId: request.id }
  }));
}

/** Documents the interpolateArgs helper. */
function interpolateArgs(args: string[], input: BuildAgentCommandInput): string[] {
  return args.map((arg) => arg
    .replaceAll("{prompt}", input.prompt || "")
    .replaceAll("{entityPath}", input.entity.path)
    .replaceAll("{workSessionId}", input.workSession?.id || ""));
}

/** Documents the compactEnv helper. */
function compactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Documents the hash helper. */
function hash(value: string): number {
  let hashValue = 0;
  for (const char of value) hashValue = Math.imul(31, hashValue) + char.charCodeAt(0) | 0;
  return hashValue;
}
