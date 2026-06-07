import type { CliCommandSpec } from "@tangent/core";

export const convosCommandSpec: CliCommandSpec = {
  name: "convos",
  description: "Capture and query coding-agent conversation telemetry",
  subcommands: [
    { name: "status", description: "Show provider tracking and local data status", args: "[repo]", options: commonJsonOptions(["verbose"]) },
    {
      name: "hooks",
      description: "Install or uninstall provider hooks",
      subcommands: [
        { name: "install", description: "Install convos hooks", options: hookOptions() },
        { name: "uninstall", description: "Remove convos hooks", options: hookOptions() }
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
    { name: "conversations", description: "List conversations", args: "[repo]", options: commonJsonOptions(["provider", "started-after", "started-before"]) },
    { name: "messages", description: "Print visible or internal messages", args: "<conversation-id>", options: commonJsonOptions(["repo", "internal"]) },
    { name: "tools", description: "Print tool calls", args: "<conversation-id>", options: commonJsonOptions(["repo", "include-results"]) },
    { name: "tokens", description: "Print token usage", args: "<conversation-id>", options: commonJsonOptions(["repo", "by"]) },
    { name: "export", description: "Export normalized JSONL events", args: "[repo]", options: commonJsonOptions(["provider", "since", "until"]) },
    { name: "doctor", description: "Show verbose diagnostics", args: "[repo]" }
  ]
};

function hookOptions(providerValues = ["all", "claude", "codex"]) {
  return [
    { name: "provider", takesValue: true, values: providerValues, description: "Provider to configure" },
    { name: "scope", takesValue: true, values: ["global", "repo-local", "repo-shared"], description: "Hook installation scope" },
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "tracking", takesValue: true, values: ["all", "allowlist", "off"], description: "Tracking policy" }
  ];
}

function commonJsonOptions(names: string[]) {
  return names.map((name) => {
    if (name === "json") return { name, description: "Print JSON" };
    if (name === "verbose") return { name, description: "Print verbose details" };
    if (name === "provider") return { name, takesValue: true, values: ["claude", "codex"], description: "Provider filter" };
    if (name === "by") return { name, takesValue: true, values: ["model", "tool"], description: "Grouping mode" };
    if (name === "internal" || name === "include-results") return { name, description: "Include extra detail" };
    return { name, takesValue: true, description: `${name} value` };
  });
}
