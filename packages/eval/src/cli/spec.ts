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
    { name: "report", description: "Print a compact eval report", args: "<run-id>", options: [{ name: "json", description: "Print JSON" }] },
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
