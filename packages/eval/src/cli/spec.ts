import type { CliCommandSpec } from "@tangent/core";

const agentOptions = [
  { name: "agent", takesValue: true, values: ["manual", "codex-cli", "claude-cli"], description: "Agent runner" },
  { name: "model", takesValue: true, values: ["gpt-5.4", "gpt-5.4-mini", "sonnet", "haiku", "opus"], description: "Agent model" },
  { name: "command", takesValue: true, description: "Agent command" },
  { name: "profile", takesValue: true, description: "Codex profile" },
  { name: "sandbox", takesValue: true, values: ["read-only", "workspace-write", "danger-full-access"], description: "Codex sandbox" },
  { name: "permission-mode", takesValue: true, description: "Claude permission mode" },
  { name: "timeout-ms", takesValue: true, description: "Agent timeout" }
];

const markStatusValues = ["new", "suggested", "triaged", "eval-created", "fixed", "dismissed"];
const markKindValues = ["failure", "candidate"];

export const markCommandSpec: CliCommandSpec = {
  name: "mark",
  description: "Capture and manage agent behavior marks",
  args: "[note]",
  options: [
    { name: "json", description: "Read a full or partial mark record from stdin" },
    { name: "session", takesValue: true, description: "Session id to anchor the mark to, instead of the cwd-resolved current session" },
    { name: "turn", takesValue: true, description: "Message ordinal to anchor the mark to" },
    { name: "observed", takesValue: true, description: "What happened; overrides the bare note" },
    { name: "expected", takesValue: true, description: "What should have happened" },
    { name: "hypothesis", takesValue: true, description: "Why the agent did not know better" },
    { name: "kind", takesValue: true, values: markKindValues, description: "Mark kind" },
    { name: "repo", takesValue: true, description: "Repository path" }
  ],
  subcommands: [
    {
      name: "list",
      description: "List marks, newest first",
      options: [
        { name: "status", takesValue: true, values: markStatusValues, description: "Filter by status" },
        { name: "kind", takesValue: true, values: markKindValues, description: "Filter by kind" },
        { name: "repo", takesValue: true, description: "Filter by repo root" },
        { name: "json", description: "Print JSON" }
      ]
    },
    { name: "show", description: "Show a mark", args: "<id>", options: [] },
    {
      name: "update",
      description: "Update a mark's status or links",
      args: "<id>",
      options: [
        { name: "status", takesValue: true, values: markStatusValues, description: "New status" },
        { name: "link-eval", takesValue: true, description: "Linked eval name" },
        { name: "link-fix", takesValue: true, description: "Linked fix reference" }
      ]
    },
    {
      name: "to-eval",
      description: "Promote a mark into a runnable eval scaffold",
      args: "<id>",
      options: [
        { name: "name", takesValue: true, description: "Eval slug override; defaults to the mark's own slug" },
        { name: "repo", takesValue: true, description: "Repository path; defaults to the mark's repo" },
        { name: "phases", takesValue: true, description: "Comma-separated phases" },
        ...agentOptions
      ]
    },
    {
      name: "scan",
      description: "Sweep recent conversations and write suggested marks for review",
      options: [
        { name: "days", takesValue: true, description: "Lookback window in days (default 7)" },
        { name: "repo", takesValue: true, description: "Restrict the scan to one repo; defaults to all projects and profiles" },
        { name: "model", takesValue: true, description: "Judge model (default haiku)" },
        { name: "limit", takesValue: true, description: "Max model calls for this scan, largest-cost conversations first (default 20)" },
        { name: "dry-run", description: "Print would-be marks without writing them" }
      ]
    }
  ]
};

export const evalCommandSpec: CliCommandSpec = {
  name: "eval",
  description: "Prepare, run, and compare local coding-agent eval variants",
  subcommands: [
    { name: "init", description: "Create an evals directory", options: [] },
    {
      name: "context",
      description: "Capture or inspect eval context snapshots",
      subcommands: [
        {
          name: "capture",
          description: "Capture context files into a special git ref",
          args: "<name>",
          options: [
            { name: "repo", takesValue: true, description: "Repository path" },
            { name: "cwd", takesValue: true, description: "Execution cwd inside repo" },
            { name: "include-ancestors", description: "Include ancestor context files" },
            { name: "include-dirty-context", description: "Allow dirty context files" },
            { name: "from-ref", takesValue: true, description: "Capture context from a git ref" },
            { name: "empty", description: "Create an empty context snapshot" },
            { name: "json", description: "Print JSON" }
          ]
        }
      ]
    },
    {
      name: "capture",
      description: "Capture reusable eval inputs",
      subcommands: [
        {
          name: "task",
          description: "Create an eval spec from a prompt",
          args: "<id>",
          options: [
            { name: "prompt", takesValue: true, description: "Prompt path, or -" },
            { name: "repo", takesValue: true, description: "Repository path" },
            { name: "repo-ref", takesValue: true, description: "Repository ref" },
            { name: "cwd", takesValue: true, description: "Execution cwd inside repo" },
            { name: "context", takesValue: true, description: "Default context mode/ref" },
            { name: "variant", takesValue: true, description: "Variant id:mode[:ref]" },
            { name: "phases", takesValue: true, description: "Comma-separated phases" },
            ...agentOptions
          ]
        }
      ]
    },
    { name: "prepare", description: "Create worktrees and context commits", args: "<eval.json>", options: [{ name: "json", description: "Print JSON" }] },
    {
      name: "run",
      description: "Prepare and run eval variants",
      args: "[eval.json]",
      options: [
        { name: "repo", takesValue: true, description: "Repo ref for shortcut mode" },
        { name: "repo-path", takesValue: true, description: "Repo path for shortcut mode" },
        { name: "prompt", takesValue: true, description: "Prompt path; repeatable" },
        { name: "context", takesValue: true, description: "Context mode/ref; repeatable" },
        { name: "phases", takesValue: true, description: "Comma-separated phases" },
        { name: "json", description: "Print JSON" },
        ...agentOptions
      ]
    },
    {
      name: "quick",
      description: "Run shortcut eval variants from prompt and context flags",
      options: [
        { name: "repo", takesValue: true, description: "Repo ref for shortcut mode" },
        { name: "repo-path", takesValue: true, description: "Repo path for shortcut mode" },
        { name: "prompt", takesValue: true, description: "Prompt path; repeatable" },
        { name: "context", takesValue: true, description: "Context mode/ref; repeatable" },
        { name: "phases", takesValue: true, description: "Comma-separated phases" },
        { name: "json", description: "Print JSON" },
        ...agentOptions
      ]
    },
    { name: "collect", description: "Collect git and usage metrics for a run", args: "<run-id>", options: [{ name: "json", description: "Print JSON" }] },
    {
      name: "report",
      description: "Print a compact eval report, or render report.md / report.html with --format",
      args: "<run-id>",
      options: [
        { name: "json", description: "Print JSON" },
        { name: "format", takesValue: true, values: ["md", "html"], description: "Render report.md or report.html instead of the terminal report" },
        { name: "out", takesValue: true, description: "Output file path (default report.md / report.html in the run dir)" }
      ]
    },
    {
      name: "diff",
      description: "Compare two variants in a run",
      args: "<run-id> <variant-a> <variant-b>",
      options: [
        { name: "phase", takesValue: true, values: ["context", "plan", "impl", "all"], description: "Comparison phase" },
        { name: "case", takesValue: true, description: "Case id when variant ids are ambiguous" }
      ]
    },
    { name: "open", description: "Print a variant worktree path", args: "<run-id> <variant>", options: [{ name: "case", takesValue: true, description: "Case id" }] },
    {
      name: "ui",
      description: "Start the local Eval UI for prepared runs",
      args: "[run-id|latest]",
      options: [
        { name: "host", takesValue: true, description: "Host to bind" },
        { name: "port", takesValue: true, description: "Port to bind" },
        { name: "no-browser", description: "Do not open the browser" },
        { name: "json", description: "Print JSON" }
      ]
    }
  ]
};
