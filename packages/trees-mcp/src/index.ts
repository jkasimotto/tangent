import readline from "node:readline";

import type { TreesClient } from "@tangent/trees-core";

export type TreesMcpCapabilities = {
  allowDangerous?: boolean;
  ensureWorktree?: (input: Record<string, unknown>) => Promise<unknown>;
  startAgent?: (input: Record<string, unknown>) => Promise<unknown>;
  sendAgent?: (input: Record<string, unknown>) => Promise<unknown>;
  stopAgent?: (input: Record<string, unknown>) => Promise<unknown>;
  captureTerminal?: (input: Record<string, unknown>) => Promise<unknown>;
};

export type TreesMcpTool = {
  name: string;
  description: string;
  dangerous?: boolean;
  inputSchema: Record<string, unknown>;
  call(input: Record<string, unknown>): Promise<unknown>;
};

/** Documents the createTreesMcpTools helper. */
export function createTreesMcpTools(client: TreesClient, capabilities: TreesMcpCapabilities = {}): TreesMcpTool[] {
  /** Documents the tool helper. */
  const tool = (name: string, description: string, call: TreesMcpTool["call"], dangerous = false): TreesMcpTool => ({
    name,
    description,
    dangerous,
    inputSchema: { type: "object", additionalProperties: true },
    /** Documents the call helper. */
    async call(input) {
      if (dangerous && !capabilities.allowDangerous) throw new Error(`${name} requires dangerous MCP capability enablement.`);
      await client.events.append({ type: "mcp.toolCalled", data: { name, input: scrubInput(input), dangerous } });
      return call(input);
    }
  });

  return [
    tool("trees_survey", "List tree entities, active work, and open attention", async () => ({
      entities: await client.entities.list(),
      sessions: await client.sessions.list(),
      attention: await client.attention.list()
    })),
    tool("trees_get_entity", "Get one entity by path or id", async (input) => client.entities.get(requiredString(input.ref, "ref"))),
    tool("trees_create_entity", "Create a tree entity", async (input) => client.entities.create({
      path: requiredString(input.path, "path"),
      kind: optionalString(input.kind),
      projectId: optionalString(input.projectId),
      repoRoot: optionalString(input.repoRoot),
      worktreePath: optionalString(input.worktreePath),
      branch: optionalString(input.branch),
      description: optionalString(input.description)
    })),
    tool("trees_update_entity", "Update an entity", async (input) => client.entities.update(requiredString(input.ref, "ref"), objectValue(input.patch))),
    tool("trees_move_entity", "Move an entity path", async (input) => client.entities.move(requiredString(input.ref, "ref"), requiredString(input.toPath, "toPath"))),
    tool("trees_delete_entity", "Delete an entity", async (input) => client.entities.delete(requiredString(input.ref, "ref")).then(() => ({ ok: true })), true),
    tool("trees_ensure_worktree", "Ensure an entity worktree", async (input) => capability(capabilities.ensureWorktree, "ensureWorktree")(input), true),
    tool("trees_worktree_status", "Read worktree status", async (input) => capability(capabilities.ensureWorktree, "ensureWorktree status provider")(input)),
    tool("trees_start_agent", "Start an agent", async (input) => capability(capabilities.startAgent, "startAgent")(input), true),
    tool("trees_send_agent", "Send text to an agent", async (input) => capability(capabilities.sendAgent, "sendAgent")(input), true),
    tool("trees_stop_agent", "Stop an agent", async (input) => capability(capabilities.stopAgent, "stopAgent")(input), true),
    tool("trees_capture_terminal", "Capture terminal output", async (input) => capability(capabilities.captureTerminal, "captureTerminal")(input)),
    tool("trees_list_attention", "List attention items", async (input) => client.attention.list({ kind: optionalString(input.kind), severity: optionalString(input.severity), all: Boolean(input.all) })),
    tool("trees_ack_attention", "Acknowledge attention", async (input) => client.attention.ack(requiredString(input.id, "id"))),
    tool("trees_resolve_attention", "Resolve attention", async (input) => client.attention.resolve(requiredString(input.id, "id"), optionalString(input.note))),
    tool("trees_start_session", "Start a work session", async (input) => client.sessions.start({ entity: requiredString(input.entity, "entity"), intent: optionalString(input.intent), doneWhen: optionalString(input.doneWhen) })),
    tool("trees_checkpoint_session", "Checkpoint a work session", async (input) => client.sessions.checkpoint(requiredString(input.ref, "ref"), objectValue(input.checkpoint))),
    tool("trees_add_capture", "Add a capture", async (input) => client.captures.add({ entity: optionalString(input.entity), kind: optionalString(input.kind) as never, text: requiredString(input.text, "text") })),
    tool("trees_list_captures", "List captures", async (input) => client.captures.list({ entity: optionalString(input.entity), all: Boolean(input.all) })),
    tool("trees_resolve_capture", "Resolve a capture", async (input) => client.captures.resolve(requiredString(input.id, "id"), { checkpointId: optionalString(input.checkpointId), note: optionalString(input.note) }))
  ];
}

/** Documents the runTreesMcpStdio helper. */
export async function runTreesMcpStdio(client: TreesClient, capabilities: TreesMcpCapabilities = {}): Promise<void> {
  const tools = new Map(createTreesMcpTools(client, capabilities).map((tool) => [tool.name, tool]));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line) as { tool?: string; input?: Record<string, unknown>; id?: unknown };
      const selected = request.tool ? tools.get(request.tool) : undefined;
      if (!selected) throw new Error(`Unknown Trees MCP tool: ${String(request.tool)}`);
      const result = await selected.call(request.input || {});
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: (error as Error).message })}\n`);
    }
  }
}

/** Documents the requiredString helper. */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value;
}

/** Documents the optionalString helper. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Documents the objectValue helper. */
function objectValue(value: unknown): Record<string, never> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, never> : {};
}

/** Documents the capability helper. */
function capability<T extends (input: Record<string, unknown>) => Promise<unknown>>(handler: T | undefined, name: string): T {
  if (!handler) throw new Error(`Trees MCP ${name} capability is not enabled.`);
  return handler;
}

/** Documents the scrubInput helper. */
function scrubInput(input: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = { ...input };
  if (typeof scrubbed.prompt === "string" && scrubbed.prompt.length > 120) scrubbed.prompt = `${scrubbed.prompt.slice(0, 120)}...`;
  if (typeof scrubbed.text === "string" && scrubbed.text.length > 120) scrubbed.text = `${scrubbed.text.slice(0, 120)}...`;
  return scrubbed;
}
