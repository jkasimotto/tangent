import type { CliCommandSpec } from "@tangent/core";

const dateValues = ["today", "yesterday", "tomorrow", "-1d", "+1d", "20260601-20260610"];

export const rollupCommandSpec: CliCommandSpec = {
  name: "rollup",
  description: "Print, generate, and read private rollup notes from usage",
  args: "[today|yesterday|YYYY-MM-DD|YYYYMMDD|YYYYMMDD-YYYYMMDD|repo]",
  values: dateValues,
  options: processOptions(["purpose", "focus", "title", "kind", "audience", "output", "filename", "overwrite", "dry-run", "explain"]),
  subcommands: [
    {
      name: "init",
      description: "Initialize private rollup config for a repo",
      args: "[repo]",
      options: [
        { name: "output", takesValue: true, values: ["user-global", "repo-local-private"], description: "Output location mode" },
        { name: "repo-local", description: "Use repo-local private output" },
        { name: "summary-provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Summarizer provider" },
        { name: "model", takesValue: true, values: ["gpt-5.4-mini", "gpt-5.4", "sonnet", "haiku", "opus"], description: "Summarizer model" },
        { name: "sandbox", takesValue: true, values: ["read-only", "workspace-write", "danger-full-access"], description: "Codex sandbox" },
        { name: "base-dir", takesValue: true, description: "Override rollup output directory" },
        { name: "notes-dir", takesValue: true, description: "Override notes directory" },
        { name: "artifacts-dir", takesValue: true, description: "Override artifacts directory" }
      ]
    },
    { name: "status", description: "Show rollup status", args: "[repo]", options: jsonDateOptions() },
    { name: "candidates", description: "List candidate turns", args: "[repo]", options: processOptions(["force", "json", "trace"]) },
    {
      name: "note",
      description: "Print, open, or locate a rollup note",
      args: "[today|yesterday|YYYY-MM-DD|YYYYMMDD-YYYYMMDD|repo]",
      options: [
        { name: "date", takesValue: true, values: dateValues, description: "Rollup selector" },
        { name: "path", description: "Print only the note path" },
        { name: "open", description: "Open the note with the OS opener" },
        { name: "json", description: "Print JSON" },
        { name: "repo", takesValue: true, description: "Repository path for aliases" }
      ],
      subcommands: [
        { name: "path", description: "Print only the note path", args: "[today|yesterday|YYYY-MM-DD|YYYYMMDD-YYYYMMDD|-1d]", values: dateValues, options: [{ name: "repo", takesValue: true, description: "Repository path" }, { name: "date", takesValue: true, values: dateValues, description: "Rollup selector" }] }
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
    { name: "render", description: "Render a rollup note", args: "[repo]", options: processOptions(["dry-run", "explain", "json"]) },
    {
      name: "config",
      description: "Show or edit rollup config",
      subcommands: [
        { name: "show", description: "Print merged config", options: [{ name: "repo", takesValue: true, description: "Repository path" }] },
        { name: "set", description: "Set private config value", args: "<path> <value>", options: [{ name: "repo", takesValue: true, description: "Repository path" }] }
      ]
    }
  ]
};

/**
 * Returns JSON/date options used by rollup `status` command.
 */
function jsonDateOptions() {
  return [
    { name: "json", description: "Print JSON" },
    { name: "date", takesValue: true, values: dateValues, description: "Rollup selector" }
  ];
}

/**
 * Builds rollup command-line options used by multiple subcommands.
 */
function processOptions(extra: string[] = []) {
  const options = [
    { name: "date", takesValue: true, values: dateValues, description: "Rollup selector" },
    { name: "from", takesValue: true, description: "Start date/time" },
    { name: "to", takesValue: true, description: "End date/time" },
    { name: "provider", takesValue: true, values: ["claude", "codex"], description: "Provider filter" }
  ];
  for (const name of extra) {
    if (name === "conversation") options.push({ name, takesValue: true, description: "Conversation id" });
    else if (name === "source") options.push({ name, takesValue: true, description: "Source key" });
    else if (name === "path") options.push({ name, takesValue: false, description: "Print artifact path" });
    else if (name === "trace") options.push({ name, takesValue: false, description: "Print timing trace" });
    else if (name === "verbose") options.push({ name, takesValue: false, description: "Print verbose details" });
    else if (name === "dry-run") options.push({ name, takesValue: false, description: "Do not write output" });
    else if (name === "explain") options.push({ name, takesValue: false, description: "Explain render inputs" });
    else if (name === "purpose") options.push({ name, takesValue: true, description: "Purposeful roll-up request" });
    else if (name === "focus") options.push({ name, takesValue: true, description: "Focus term; repeatable" });
    else if (name === "title") options.push({ name, takesValue: true, description: "Output title" });
    else if (name === "kind") options.push({ name, takesValue: true, values: ["daily-memory", "design-brief", "investigation-brief", "decision-log", "implementation-brief"], description: "Roll-up output kind" });
    else if (name === "audience") options.push({ name, takesValue: true, values: ["self", "engineering-team", "future-agent"], description: "Intended reader" });
    else if (name === "output") options.push({ name, takesValue: true, description: "Markdown output path" });
    else if (name === "filename") options.push({ name, takesValue: true, description: "Markdown filename under notesDir" });
    else if (name === "overwrite") options.push({ name, takesValue: false, description: "Overwrite explicit output file without generated block" });
    else options.push({ name, takesValue: false, description: `${name} flag` });
  }
  return options;
}

/**
 * Returns provider-related options for provider diagnostics subcommands.
 */
function providerOptions() {
  return [
    { name: "provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Summary provider" },
    { name: "model", takesValue: true, values: ["gpt-5.4-mini", "gpt-5.4", "sonnet", "haiku", "opus"], description: "Model" },
    { name: "command", takesValue: true, description: "Provider command" },
    { name: "sandbox", takesValue: true, values: ["read-only", "workspace-write", "danger-full-access"], description: "Codex sandbox" },
    { name: "json", takesValue: false, description: "Print JSON" }
  ];
}
