import os from "node:os";
import path from "node:path";

import type {
  ReviewedAgentBinding,
  ReviewedCompletionEnvelope,
  ReviewedStepDefinition
} from "./types.js";

export const REVIEWED_BUILD_STEPS: ReviewedStepDefinition[] = [
  {
    id: "design",
    order: 1,
    label: "Create the design",
    instruction: "Create or update the project-native design document. Resolve important questions from the repository and supplied context.",
    defaultBinding: "claude",
    requiredArtifacts: ["design"],
    requiresRepositoryChange: false,
    requiresProof: false,
    restrictChangesToArtifacts: true,
    review: false
  },
  {
    id: "design-review",
    order: 2,
    label: "Review the design",
    instruction: "Review the design against the original request and repository facts. Do not edit the design. Write a separate review document.",
    defaultBinding: "codex",
    requiredArtifacts: ["design-review"],
    requiresRepositoryChange: false,
    requiresProof: false,
    restrictChangesToArtifacts: true,
    review: true
  },
  {
    id: "respond-and-plan",
    order: 3,
    label: "Respond and plan",
    instruction: "Read the design review. Update the design for accepted findings, record any reasoned disagreement, and write a concrete implementation plan.",
    defaultBinding: "claude",
    requiredArtifacts: ["design", "implementation-plan"],
    requiresRepositoryChange: false,
    requiresProof: false,
    restrictChangesToArtifacts: true,
    review: false
  },
  {
    id: "plan-review",
    order: 4,
    label: "Review the implementation plan",
    instruction: "Review the implementation plan against the request, approved design, and repository. Do not edit the plan. Write a separate review document.",
    defaultBinding: "codex",
    requiredArtifacts: ["implementation-plan-review"],
    requiresRepositoryChange: false,
    requiresProof: false,
    restrictChangesToArtifacts: true,
    review: true
  },
  {
    id: "respond-to-plan-review",
    order: 5,
    label: "Respond to the plan review",
    instruction: "Read the plan review. Update the implementation plan for accepted findings and record any reasoned disagreement.",
    defaultBinding: "claude",
    requiredArtifacts: ["implementation-plan"],
    requiresRepositoryChange: false,
    requiresProof: false,
    restrictChangesToArtifacts: true,
    review: false
  },
  {
    id: "implement",
    order: 6,
    label: "Implement",
    instruction: "Implement the approved design and plan. Preserve unrelated worktree changes. Run proportionate repository checks and report their exact results.",
    defaultBinding: "codex",
    requiredArtifacts: [],
    requiresRepositoryChange: true,
    requiresProof: true,
    restrictChangesToArtifacts: false,
    review: false
  },
  {
    id: "implementation-review",
    order: 7,
    label: "Review the implementation",
    instruction: "Review the implementation, diff, and proof against the original request, design, and plan. Do not edit the implementation. Write a separate review document.",
    defaultBinding: "claude",
    requiredArtifacts: ["implementation-review"],
    requiresRepositoryChange: false,
    requiresProof: false,
    restrictChangesToArtifacts: true,
    review: true
  },
  {
    id: "respond-and-fix",
    order: 8,
    label: "Respond and fix",
    instruction: "Respond to every implementation-review finding. Apply accepted fixes, explain reasoned disagreements, and run final proof. Do not request another automatic review.",
    defaultBinding: "codex",
    requiredArtifacts: ["review-response"],
    requiresRepositoryChange: false,
    requiresProof: true,
    restrictChangesToArtifacts: false,
    review: false
  }
];

export const REVIEWED_COMPLETION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { enum: ["complete", "needs_judgment"] },
    summary: { type: "string" },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          purpose: {
            enum: [
              "design",
              "design-review",
              "implementation-plan",
              "implementation-plan-review",
              "implementation-review",
              "review-response",
              "supporting"
            ]
          }
        },
        required: ["path", "purpose"]
      }
    },
    proof: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string" },
          result: { type: "string" }
        },
        required: ["command", "result"]
      }
    },
    question: { anyOf: [{ type: "string" }, { type: "null" }] }
  },
  required: ["status", "summary", "artifacts", "proof", "question"]
};

/** Returns the built-in Claude and Codex bindings for Reviewed build. */
export function builtInReviewedBindings(env: NodeJS.ProcessEnv = process.env): Record<"claude" | "codex", ReviewedAgentBinding> {
  return {
    claude: {
      id: "claude-fable",
      label: "Claude Fable",
      provider: "claude",
      command: env.TANGENT_REVIEWED_CLAUDE_COMMAND || "claude",
      model: env.TANGENT_REVIEWED_CLAUDE_MODEL || "fable",
      permissionMode: env.TANGENT_REVIEWED_CLAUDE_PERMISSION_MODE || "bypassPermissions"
    },
    codex: {
      id: "codex-max",
      label: "Codex Max",
      provider: "codex",
      command: env.TANGENT_REVIEWED_CODEX_COMMAND || "codex",
      model: env.TANGENT_REVIEWED_CODEX_MODEL || undefined,
      effort: env.TANGENT_REVIEWED_CODEX_EFFORT || "max"
    }
  };
}

/** Converts one Area agent declaration into a runnable provider binding. */
export function bindingFromAgentPreset(raw: Record<string, unknown>): ReviewedAgentBinding | undefined {
  const id = stringValue(raw.id);
  const label = stringValue(raw.label) || id;
  const exactCommand = stringValue(raw.command);
  if (!id || !label || !exactCommand) return undefined;
  const words = splitShellWords(exactCommand);
  const env: Record<string, string> = {};
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const entry = words.shift()!;
    const equal = entry.indexOf("=");
    env[entry.slice(0, equal)] = expandHome(entry.slice(equal + 1));
  }
  const command = words.shift();
  if (!command) return undefined;
  const provider = inferredProvider(raw, command);
  if (!provider) return undefined;
  const parsed = parseProviderArgs(words, provider);
  return {
    id,
    label,
    provider,
    command,
    loginShell: true,
    exactCommand,
    model: stringValue(raw.model) || parsed.model,
    profile: parsed.profile,
    effort: stringValue(raw.effort) || parsed.effort,
    permissionMode: parsed.permissionMode,
    extraArgs: parsed.extraArgs.length ? parsed.extraArgs : undefined,
    env: Object.keys(env).length ? env : undefined
  };
}

/** Selects the closest Area presets for the two built-in roles. */
export function selectReviewedBindings(presets: ReviewedAgentBinding[], env: NodeJS.ProcessEnv = process.env): Record<"claude" | "codex", ReviewedAgentBinding> {
  const fallback = builtInReviewedBindings(env);
  const claude = presets.find((item) => item.provider === "claude" && /fable/i.test(`${item.id} ${item.label}`))
    || presets.find((item) => item.provider === "claude");
  const codex = presets.find((item) => item.provider === "codex" && (/max/i.test(`${item.id} ${item.label}`) || item.effort === "max"))
    || presets.find((item) => item.provider === "codex");
  return { claude: claude || fallback.claude, codex: codex || fallback.codex };
}

/** Parses and validates one provider completion object. */
export function parseReviewedEnvelope(value: unknown): ReviewedCompletionEnvelope {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The agent did not return a completion object.");
  const input = parsed as Record<string, unknown>;
  if (input.status !== "complete" && input.status !== "needs_judgment") throw new Error("Completion status must be complete or needs_judgment.");
  if (typeof input.summary !== "string" || !input.summary.trim()) throw new Error("Completion summary is required.");
  if (!Array.isArray(input.artifacts)) throw new Error("Completion artifacts must be an array.");
  if (!Array.isArray(input.proof)) throw new Error("Completion proof must be an array.");
  const artifacts = input.artifacts.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each artifact must be an object.");
    const artifact = item as Record<string, unknown>;
    if (typeof artifact.path !== "string" || typeof artifact.purpose !== "string") throw new Error("Each artifact needs a path and purpose.");
    return { path: artifact.path, purpose: artifact.purpose } as ReviewedCompletionEnvelope["artifacts"][number];
  });
  const proof = input.proof.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each proof item must be an object.");
    const entry = item as Record<string, unknown>;
    if (typeof entry.command !== "string" || typeof entry.result !== "string") throw new Error("Each proof item needs a command and result.");
    return { command: entry.command, result: entry.result };
  });
  const question = input.question === null ? null : typeof input.question === "string" ? input.question : undefined;
  if (question === undefined) throw new Error("Completion question must be a string or null.");
  if (input.status === "needs_judgment" && !question?.trim()) throw new Error("A judgment pause needs a question.");
  return { status: input.status, summary: input.summary.trim(), artifacts, proof, question };
}

/** Parses a JSON object after removing a Markdown fence when needed. */
function parseJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(stripped); } catch { throw new Error("The agent completion is not valid JSON."); }
}

/** Reads one non-empty string field. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Infers a supported CLI provider from preset metadata or the command name. */
function inferredProvider(raw: Record<string, unknown>, command: string): ReviewedAgentBinding["provider"] | undefined {
  const source = `${stringValue(raw.harness) || ""} ${stringValue(raw.provider) || ""} ${path.basename(command)}`.toLowerCase();
  if (source.includes("claude") || source.includes("anthropic")) return "claude";
  if (source.includes("codex") || source.includes("openai")) return "codex";
  if (source.includes("gemini") || source.includes("google")) return "gemini";
  return undefined;
}

/** Extracts provider flags that the shared runner owns and preserves all other flags. */
function parseProviderArgs(words: string[], provider: ReviewedAgentBinding["provider"]): {
  model?: string;
  profile?: string;
  effort?: string;
  permissionMode?: string;
  extraArgs: string[];
} {
  const output: { model?: string; profile?: string; effort?: string; permissionMode?: string; extraArgs: string[] } = { extraArgs: [] };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if ((word === "--model" || word === "-m") && next) { output.model = next; index += 1; continue; }
    if (provider === "codex" && (word === "--profile" || word === "-p") && next) { output.profile = next; index += 1; continue; }
    if (provider === "claude" && word === "--effort" && next) { output.effort = next; index += 1; continue; }
    if (provider === "claude" && word === "--permission-mode" && next) { output.permissionMode = next; index += 1; continue; }
    if (provider === "codex" && (word === "--config" || word === "-c") && next && /^model_reasoning_effort=/.test(next)) {
      output.effort = next.slice(next.indexOf("=") + 1).replace(/^['\"]|['\"]$/g, "");
      index += 1;
      continue;
    }
    output.extraArgs.push(word);
  }
  return output;
}

/** Splits the small shell-command subset used by Area presets. */
function splitShellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = "";
      else if (character === "\\" && quote === "\"" && command[index + 1]) current += command[++index];
      else current += character;
    } else if (character === "'" || character === "\"") quote = character;
    else if (/\s/.test(character)) {
      if (current) { words.push(current); current = ""; }
    } else if (character === "\\" && command[index + 1]) current += command[++index];
    else current += character;
  }
  if (quote) throw new Error(`Unclosed quote in agent command: ${command}`);
  if (current) words.push(current);
  return words;
}

/** Expands a leading home marker in one saved value. */
function expandHome(value: string): string {
  return value.replace(/^~(?=\/|$)/, os.homedir());
}
