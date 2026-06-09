import type { CliCommandSpec } from "@tangent/core";

const dateValues = ["today", "yesterday", "tomorrow", "-1d", "+1d"];

export const dailyCommandSpec: CliCommandSpec = {
  name: "daily",
  description: "Print, generate, and read private daily notes from usage",
  values: dateValues,
  subcommands: [
    {
      name: "init",
      description: "Initialize private daily config for a repo",
      args: "[repo]",
      options: [
        { name: "output", takesValue: true, values: ["user-global", "repo-local-private"], description: "Output location mode" },
        { name: "repo-local", description: "Use repo-local private output" },
        { name: "summary-provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Summarizer provider" },
        { name: "model", takesValue: true, values: ["gpt-5.4-mini", "gpt-5.4", "sonnet", "haiku", "opus"], description: "Summarizer model" },
        { name: "sandbox", takesValue: true, values: ["read-only", "workspace-write", "danger-full-access"], description: "Codex sandbox" },
        { name: "base-dir", takesValue: true, description: "Override daily output directory" },
        { name: "notes-dir", takesValue: true, description: "Override notes directory" },
        { name: "artifacts-dir", takesValue: true, description: "Override artifacts directory" }
      ]
    },
    { name: "status", description: "Show daily status", args: "[repo]", options: jsonDateOptions() },
    { name: "rollup", description: "Write one daily note from usage conversations", args: "[repo]", options: processOptions(["force", "dry-run", "json", "verbose"]) },
    { name: "process", description: "Alias for rollup", args: "[repo]", options: processOptions(["force", "dry-run", "json", "verbose"]) },
    { name: "candidates", description: "List candidate turns", args: "[repo]", options: processOptions(["force", "json", "trace"]) },
    { name: "unprocessed", description: "Alias for candidates", args: "[repo]", options: processOptions(["force", "json", "trace"]) },
    {
      name: "note",
      description: "Print, open, or locate a daily note",
      args: "[repo]",
      options: [
        { name: "date", takesValue: true, values: dateValues, description: "Date bucket" },
        { name: "path", description: "Print only the note path" },
        { name: "open", description: "Open the note with the OS opener" },
        { name: "json", description: "Print JSON" },
        { name: "repo", takesValue: true, description: "Repository path for aliases" }
      ],
      subcommands: [
        { name: "path", description: "Print only the note path", args: "[today|yesterday|YYYY-MM-DD|-1d]", values: dateValues, options: [{ name: "repo", takesValue: true, description: "Repository path" }, { name: "date", takesValue: true, values: dateValues, description: "Date bucket" }] }
      ]
    },
    { name: "reprocess", description: "Force reprocessing", args: "[repo]", options: processOptions(["source", "all", "json"]) },
    { name: "retry", description: "Retry failed turns", args: "[repo]", options: processOptions(["source", "all", "json"]) },
    {
      name: "provider",
      description: "Test or inspect summary providers",
      subcommands: [
        { name: "test", description: "Check provider availability", options: providerOptions() },
        { name: "models", description: "List provider models when available", options: providerOptions() }
      ]
    },
    { name: "digests", description: "List cached digests", args: "[repo]", options: jsonDateOptions() },
    { name: "input", description: "Build or locate a turn input", args: "[repo]", options: processOptions(["source", "path", "json"]) },
    { name: "digest", description: "Print latest digest for a source", args: "[repo]", options: processOptions(["source", "json"]) },
    { name: "topics", description: "List legacy topic rollups for a date", hidden: true, args: "[repo]", options: jsonDateOptions() },
    { name: "render", description: "Render a daily note", args: "[repo]", options: processOptions(["dry-run", "explain", "json"]) },
    {
      name: "config",
      description: "Show or edit daily config",
      subcommands: [
        { name: "show", description: "Print merged config", options: [{ name: "repo", takesValue: true, description: "Repository path" }] },
        { name: "set", description: "Set private config value", args: "<path> <value>", options: [{ name: "repo", takesValue: true, description: "Repository path" }] }
      ]
    }
  ]
};

function jsonDateOptions() {
  return [
    { name: "json", description: "Print JSON" },
    { name: "date", takesValue: true, values: dateValues, description: "Date bucket" }
  ];
}

function processOptions(extra: string[] = []) {
  const options = [
    { name: "date", takesValue: true, values: dateValues, description: "Date bucket" },
    { name: "from", takesValue: true, description: "Start date/time" },
    { name: "to", takesValue: true, description: "End date/time" },
    { name: "provider", takesValue: true, values: ["claude", "codex"], description: "Provider filter" },
    { name: "include-active", description: "Include quiet active conversations" }
  ];
  for (const name of extra) {
    if (name === "conversation") options.push({ name, takesValue: true, description: "Conversation id" });
    else if (name === "source") options.push({ name, takesValue: true, description: "Source key" });
    else if (name === "path") options.push({ name, description: "Print artifact path" });
    else if (name === "trace") options.push({ name, description: "Print timing trace" });
    else if (name === "verbose") options.push({ name, description: "Print verbose details" });
    else if (name === "dry-run") options.push({ name, description: "Do not write output" });
    else if (name === "explain") options.push({ name, description: "Explain render inputs" });
    else options.push({ name, description: `${name} flag` });
  }
  return options;
}

function providerOptions() {
  return [
    { name: "provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Summary provider" },
    { name: "model", takesValue: true, values: ["gpt-5.4-mini", "gpt-5.4", "sonnet", "haiku", "opus"], description: "Model" },
    { name: "command", takesValue: true, description: "Provider command" },
    { name: "sandbox", takesValue: true, values: ["read-only", "workspace-write", "danger-full-access"], description: "Codex sandbox" },
    { name: "json", description: "Print JSON" }
  ];
}
