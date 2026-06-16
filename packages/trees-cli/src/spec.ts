import type { CliCommandSpec } from "@tangent/core";

export const treesCommandSpec: CliCommandSpec = {
  name: "trees",
  description: "Organize semantic work trees, worktrees, agents, and attention",
  subcommands: [
    { name: "init", description: "Initialize the Trees store", options: opts("json") },
    { name: "add", description: "Add a tree entity", args: "<path>", options: opts("kind", "project", "branch", "worktree", "json") },
    { name: "show", description: "Show a tree entity", args: "<path|id>", options: opts("json") },
    { name: "list", description: "List tree entities", args: "[path]", options: opts("status", "attention", "json") },
    { name: "set", description: "Set an entity field", args: "<path|id> <field> <value>", options: opts("json") },
    { name: "mv", description: "Move a tree entity", args: "<src> <dst>", options: opts("json") },
    { name: "rm", description: "Remove a tree entity", args: "<path|id>", options: opts("worktree", "branch", "force", "json") },
    { name: "project", description: "Manage projects", subcommands: [
      { name: "list", description: "List projects", options: opts("json") },
      { name: "add", description: "Register a project", args: "[name] <path>", options: opts("json") },
      { name: "rm", description: "Remove a project", args: "<name>", options: opts("json") }
    ] },
    { name: "worktree", description: "Manage worktrees", subcommands: [
      { name: "ensure", description: "Ensure an entity worktree", args: "<path|id>", options: opts("json") },
      { name: "path", description: "Print an entity worktree path", args: "<path|id>" },
      { name: "status", description: "Show worktree status", args: "<path|id>", options: opts("json") }
    ] },
    { name: "agent", description: "Manage agent runs", subcommands: [
      { name: "start", description: "Start an agent", args: "<path|id>", options: opts("agent", "model", "prompt", "runtime", "intent", "estimate", "done-when", "json") },
      { name: "send", description: "Send text to an agent", args: "<run|path> <message|->", options: opts("json") },
      { name: "status", description: "List agent status", args: "[path]", options: opts("json") },
      { name: "stop", description: "Stop an agent", args: "<run|path>", options: opts("json") }
    ] },
    { name: "terminal", description: "Open and control terminals", subcommands: [
      { name: "open", description: "Open a terminal", args: "<path|run|terminal>", options: opts("host", "json") },
      { name: "attach", description: "Attach a terminal", args: "<path|run|terminal>" },
      { name: "capture", description: "Capture terminal output", args: "<path|run|terminal>", options: opts("lines", "json") },
      { name: "send", description: "Send terminal input", args: "<path|run|terminal> <text|->", options: opts("json") }
    ] },
    { name: "attention", description: "Manage attention items", subcommands: [
      { name: "list", description: "List attention", options: opts("kind", "severity", "json") },
      { name: "ack", description: "Acknowledge attention", args: "<id>", options: opts("json") },
      { name: "resolve", description: "Resolve attention", args: "<id>", options: opts("note", "json") },
      { name: "dismiss", description: "Dismiss attention", args: "<id>", options: opts("reason", "json") }
    ] },
    { name: "session", description: "Manage work sessions", subcommands: [
      { name: "start", description: "Start a session", args: "<path|id>", options: opts("intent", "estimate", "done-when", "json") },
      { name: "checkpoint", description: "Checkpoint a session", args: "<path|session>", options: opts("outcome", "did", "learned", "evidence", "next", "blocker", "capture-id", "json") },
      { name: "list", description: "List sessions", args: "<path|id>", options: opts("json") }
    ] },
    { name: "capture", description: "Manage captures", subcommands: [
      { name: "add", description: "Add a capture", options: opts("entity", "kind", "text", "stdin", "json") },
      { name: "list", description: "List captures", options: opts("entity", "all", "json") },
      { name: "resolve", description: "Resolve a capture", args: "<id>", options: opts("checkpoint", "dismiss", "note", "json") }
    ] },
    { name: "center", description: "Print a compact command-center summary", args: "[path]" },
    { name: "events", description: "Print Trees events", options: opts("watch", "json") },
    { name: "import-pa", description: "Import legacy pa data", options: opts("from", "dry-run", "json") },
    { name: "mcp", description: "Start the Trees MCP stdio server" }
  ]
};

/** Documents the opts helper. */
function opts(...names: string[]): CliCommandSpec["options"] {
  return names.map((name) => ({
    name,
    takesValue: !["json", "status", "attention", "worktree", "branch", "force", "stdin", "all", "dismiss", "watch", "dry-run", "no-browser"].includes(name),
    description: optionDescription(name)
  }));
}

/** Documents the optionDescription helper. */
function optionDescription(name: string): string {
  if (name === "json") return "Print JSON";
  if (name === "dry-run") return "Preview changes";
  if (name === "no-browser") return "Do not open the browser";
  return `${name} value`;
}
