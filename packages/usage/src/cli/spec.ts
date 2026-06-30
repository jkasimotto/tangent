import type { CliCommandSpec } from "@tangent/core";

export const usageCommandSpec: CliCommandSpec = {
  name: "usage",
  description: "Inspect coding-agent activity, tools, sessions, and tokens",
  subcommands: [
    { name: "init", description: "Check native activity capture for a provider", args: "[repo]", options: commonJsonOptions(["provider", "json"]) },
    { name: "status", description: "Show capture health and capability coverage", args: "[repo]", options: commonJsonOptions(["verbose"]) },
    {
      name: "ui",
      description: "Start a local Usage UI",
      args: "[session|latest]",
      options: commonJsonOptions(["repo", "scope", "days", "host", "port", "no-browser", "static-ui", "json", "provider", "source"])
    },
    {
      name: "index",
      description: "Manage the usage index",
      subcommands: [
        { name: "rebuild", description: "Rebuild the usage telemetry index", args: "[repo]", options: commonJsonOptions(["provider", "force", "source", "json"]) }
      ]
    },
    {
      name: "providers",
      description: "Inspect provider adapters and capabilities",
      subcommands: [
        { name: "list", description: "List provider capabilities", options: commonJsonOptions(["json"]) },
        { name: "inspect", description: "Inspect one provider", args: "<provider>", options: commonJsonOptions(["json"]) }
      ]
    },
    {
      name: "sessions",
      description: "Query coding-agent sessions",
      subcommands: [
        { name: "list", description: "List coding-agent sessions", args: "[repo]", options: commonJsonOptions(["provider", "date", "since", "until", "source", "json", "format"]) },
        { name: "get", description: "Get one session", args: "<session|latest>", options: commonJsonOptions(["repo", "source", "json"]) },
        { name: "report", description: "Render a session report", args: "<session|latest>", options: commonJsonOptions(["repo", "provider", "source", "json"]) },
        { name: "timeline", description: "Render timeline data for a session", args: "<session|latest>", options: commonJsonOptions(["repo", "metric", "group", "format", "json"]) }
      ]
    },
    {
      name: "messages",
      description: "Query and search messages",
      subcommands: [
        { name: "query", description: "Query messages", options: commonJsonOptions(["repo", "session", "role", "min-chars", "contains", "limit", "json", "format"]) },
        { name: "search", description: "Search messages", args: "<query>", options: commonJsonOptions(["repo", "provider", "limit", "json"]) }
      ]
    },
    {
      name: "steps",
      description: "Query timeline steps",
      subcommands: [
        { name: "query", description: "Query steps", options: commonJsonOptions(["repo", "session", "kind", "order", "limit", "json", "format"]) },
        { name: "timeline", description: "Render step timeline data", options: commonJsonOptions(["repo", "session", "metric", "json", "format"]) }
      ]
    },
    {
      name: "tools",
      description: "Query tool calls",
      subcommands: [
        { name: "query", description: "Query tool calls", options: commonJsonOptions(["repo", "session", "name", "include-results", "limit", "json", "format"]) }
      ]
    },
    {
      name: "tokens",
      description: "Summarize token usage",
      subcommands: [
        { name: "summary", description: "Summarize token usage", options: commonJsonOptions(["repo", "session", "by", "json", "format"]) }
      ]
    },
    {
      name: "analytics",
      description: "Run usage aggregations",
      subcommands: [
        { name: "aggregate", description: "Aggregate usage metrics", options: commonJsonOptions(["repo", "session", "metric", "group", "json", "format"]) },
        { name: "series", description: "Build a usage series", options: commonJsonOptions(["repo", "metric", "group", "bucket", "json", "format"]) }
      ]
    },
    {
      name: "raw",
      description: "Raw normalized telemetry",
      subcommands: [
        { name: "events", description: "Print raw normalized events", options: commonJsonOptions(["repo", "session", "kind", "ndjson", "json"]) }
      ]
    },
    { name: "today", description: "Show today's coding-agent sessions", args: "[repo]", options: commonJsonOptions(["provider", "source"]) },
    { name: "session", description: "Show one session summary", hidden: true, args: "<session|latest>", options: commonJsonOptions(["repo", "source"]) },
    { name: "report", description: "Print assistant-centered session report", hidden: true, args: "<session|latest>", options: commonJsonOptions(["repo", "provider", "source", "json"]) },
    { name: "transcript", description: "Print a readable session transcript", hidden: true, args: "<session|latest>", options: commonJsonOptions(["repo", "internal", "source"]) },
    { name: "reindex", description: "Rebuild the usage telemetry index", hidden: true, args: "[repo]", options: commonJsonOptions(["provider", "force", "source"]) },
    { name: "export", description: "Export normalized events as JSONL", args: "[repo]", options: commonJsonOptions(["provider", "since", "until", "source"]) },
    { name: "events", description: "Print normalized events as JSON", hidden: true, args: "[repo]", options: commonJsonOptions(["provider", "date", "since", "until", "source"]) },
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
    { name: "prune", description: "Trim the usage index to a retention window", args: "[repo]", options: commonJsonOptions(["scope", "days", "before", "vacuum", "dry-run", "json"]) },
    { name: "import-native", description: "Import provider native transcripts as best-effort backfill", hidden: true, args: "[repo]", options: commonJsonOptions(["provider"]) },
    { name: "doctor", description: "Show verbose diagnostics", hidden: true, args: "[repo]", options: commonJsonOptions(["trace"]) }
  ]
};

/** Builds shared Usage CLI option descriptors by option name. */
function commonJsonOptions(names: string[]) {
  return names.map((name) => {
    if (name === "json") return { name, description: "Print JSON" };
    if (name === "verbose") return { name, description: "Print verbose details" };
    if (name === "trace") return { name, description: "Print timing trace" };
    if (name === "provider") return { name, takesValue: true, values: ["claude", "codex", "gemini"], description: "Provider filter" };
    if (name === "scope") return { name, takesValue: true, values: ["all", "repo"], description: "Session discovery scope (default: repo)" };
    if (name === "source") return { name, takesValue: true, values: ["native", "all"], description: "Data source" };
    if (name === "by") return { name, takesValue: true, values: ["model"], description: "Grouping mode" };
    if (name === "before" || name === "date" || name === "since" || name === "until") return { name, takesValue: true, description: `${name} date` };
    if (["format", "metric", "group", "session", "role", "min-chars", "contains", "limit", "kind", "order", "bucket", "name", "include-results"].includes(name)) return { name, takesValue: true, description: `${name} value` };
    if (name === "static-ui") return { name, description: "Serve built UI assets instead of the workspace hot-reload server" };
    if (name === "days") return { name, takesValue: true, description: "Retention window in days (default 60); applies to ui as the default view window (default 7)" };
    if (name === "internal" || name === "force" || name === "dry-run" || name === "estimate" || name === "ndjson" || name === "no-browser" || name === "vacuum") return { name, description: "Enable this option" };
    return { name, takesValue: true, description: `${name} value` };
  });
}
