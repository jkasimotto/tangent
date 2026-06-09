import type { CliCommandSpec } from "@tangent/core";

export const usageCommandSpec: CliCommandSpec = {
  name: "usage",
  description: "Inspect coding-agent activity, tools, sessions, and tokens",
  subcommands: [
    { name: "init", description: "Enable activity capture for a provider", options: hookOptions(["claude", "codex"]) },
    { name: "status", description: "Show capture health and capability coverage", args: "[repo]", options: commonJsonOptions(["verbose"]) },
    { name: "today", description: "Show today's coding-agent sessions", args: "[repo]", options: commonJsonOptions(["provider"]) },
    { name: "sessions", description: "List coding-agent sessions", args: "[repo]", options: commonJsonOptions(["provider", "date", "since", "until"]) },
    { name: "session", description: "Show one session summary", args: "<session|latest>", options: commonJsonOptions(["repo"]) },
    { name: "transcript", description: "Print a readable session transcript", args: "<session|latest>", options: commonJsonOptions(["repo", "internal"]) },
    { name: "tools", description: "Print tool calls for a session", args: "<session|latest>", options: commonJsonOptions(["repo", "include-results"]) },
    { name: "tokens", description: "Print known token usage", args: "[session|latest]", options: commonJsonOptions(["repo", "provider", "by", "estimate"]) },
    { name: "reindex", description: "Rebuild the usage telemetry index", args: "[repo]", options: commonJsonOptions(["provider", "force"]) },
    { name: "export", description: "Export normalized events as JSONL", args: "[repo]", options: commonJsonOptions(["provider", "since", "until"]) },
    { name: "events", description: "Print normalized events as JSON", args: "[repo]", options: commonJsonOptions(["provider", "date", "since", "until"]) },
    { name: "messages", description: "Print raw message query JSON", args: "<session|latest>", options: commonJsonOptions(["repo", "internal"]) },
    {
      name: "native",
      description: "Inspect provider native log schemas",
      hidden: true,
      subcommands: [
        { name: "schemas", description: "List known native log schema descriptors", options: commonJsonOptions(["provider", "json"]) },
        { name: "inspect", description: "Inspect one native log JSONL file", args: "<path>", options: commonJsonOptions(["json"]) },
        { name: "status", description: "Show native log schema compatibility", args: "[repo]", options: commonJsonOptions(["provider", "json"]) }
      ]
    },
    { name: "archive", description: "Archive indexed raw telemetry", hidden: true, args: "[repo]", options: commonJsonOptions(["before", "dry-run", "provider"]) },
    { name: "import-native", description: "Import provider native transcripts as best-effort backfill", hidden: true, args: "[repo]", options: commonJsonOptions(["provider"]) },
    {
      name: "hooks",
      description: "Install or uninstall provider hooks",
      hidden: true,
      subcommands: [
        { name: "install", description: "Install usage hooks", options: hookOptions() },
        { name: "uninstall", description: "Remove usage hooks", options: hookOptions() }
      ]
    },
    {
      name: "hook",
      description: "Hook runner entrypoints",
      hidden: true,
      subcommands: [
        { name: "record", description: "Record provider hook input", options: hookOptions(["claude", "codex"]) }
      ]
    },
    { name: "doctor", description: "Show verbose diagnostics", hidden: true, args: "[repo]", options: commonJsonOptions(["trace"]) }
  ]
};

function hookOptions(providerValues = ["all", "claude", "codex"]) {
  return [
    { name: "provider", takesValue: true, values: providerValues, description: "Provider to configure" },
    { name: "scope", takesValue: true, values: ["global", "repo-local", "repo-shared"], description: "Hook installation scope" },
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "repo-root", takesValue: true, description: "Repository root for hook recording" },
    { name: "tracking", takesValue: true, values: ["all", "allowlist", "off"], description: "Tracking policy" }
  ];
}

function commonJsonOptions(names: string[]) {
  return names.map((name) => {
    if (name === "json") return { name, description: "Print JSON" };
    if (name === "verbose") return { name, description: "Print verbose details" };
    if (name === "trace") return { name, description: "Print timing trace" };
    if (name === "provider") return { name, takesValue: true, values: ["claude", "codex"], description: "Provider filter" };
    if (name === "by") return { name, takesValue: true, values: ["model", "tool"], description: "Grouping mode" };
    if (name === "before" || name === "date" || name === "since" || name === "until") return { name, takesValue: true, description: `${name} date` };
    if (name === "internal" || name === "include-results" || name === "force" || name === "dry-run" || name === "estimate") return { name, description: "Enable this option" };
    return { name, takesValue: true, description: `${name} value` };
  });
}
