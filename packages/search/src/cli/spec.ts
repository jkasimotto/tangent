import type { CliCommandSpec } from "@tangent/core";

const languageValues = ["dart", "typescript", "javascript", "ts", "js", "all"];
const modeValues = ["precise", "normal", "broad"];

export const searchCommandSpec: CliCommandSpec = {
  name: "search",
  description: "Index and query repository structure",
  args: "[query]",
  options: searchOptions(),
  subcommands: [
    { name: "index", description: "Build or update the structural index", args: "[repo]", options: indexOptions() },
    { name: "init", description: "Initialize private search config for a repo", args: "[repo]", options: initOptions() },
    { name: "status", description: "Show search index status", args: "[repo]", options: [{ name: "json", description: "Print JSON" }] },
    { name: "doctor", description: "Show verbose search diagnostics", args: "[repo]" },
    { name: "symbol", description: "Show symbol details", args: "<name>", options: commonOptions() },
    { name: "callers", description: "Show callers of a symbol", args: "<name>", options: commonOptions() },
    { name: "callees", description: "Show callees of a symbol", args: "<name>", options: commonOptions() },
    { name: "tests", description: "Show likely tests for a path or symbol", args: "<path|symbol>", options: commonOptions() },
    { name: "skeleton", description: "Show file-level symbol skeleton", args: "<path|symbol>", options: commonOptions() },
    { name: "open-plan", description: "Print recommended read order for a task", args: "<query>", options: commonOptions() },
    { name: "grep", description: "Run grep with Tangent search excludes", args: "[grep args...]" },
    { name: "rg", description: "Run ripgrep with Tangent search excludes", args: "[rg args...]" },
    { name: "find", description: "Run find", args: "[find args...]" },
    {
      name: "config",
      description: "Show or edit search config",
      subcommands: [
        { name: "show", description: "Print merged config", options: [{ name: "repo", takesValue: true, description: "Repository path" }] },
        { name: "set", description: "Set config value", args: "<path> <value>", options: [{ name: "repo", takesValue: true, description: "Repository path" }, { name: "scope", takesValue: true, values: ["private", "global", "repo-shared"], description: "Config scope" }] }
      ]
    }
  ]
};

/** Searches options. */
function searchOptions() {
  return [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "mode", takesValue: true, values: modeValues, description: "Search mode" },
    { name: "language", takesValue: true, values: languageValues, description: "Language filter" },
    { name: "max-results", takesValue: true, description: "Max result count" },
    { name: "include-tests", description: "Include test hits" },
    { name: "json", description: "Print JSON" }
  ];
}

/** Supports the common options helper. */
function commonOptions() {
  return [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "language", takesValue: true, values: languageValues, description: "Language filter" },
    { name: "json", description: "Print JSON" }
  ];
}

/** Indexes options. */
function indexOptions() {
  return [
    { name: "language", takesValue: true, values: languageValues, description: "Language to index" },
    { name: "include-generated", description: "Include generated files" },
    { name: "force", description: "Rebuild index from scratch" },
    { name: "watch", description: "Watch and re-index changes" },
    { name: "interval", takesValue: true, description: "Watch interval seconds" },
    { name: "reedge-all", description: "Rebuild graph edges without reparsing all files" },
    { name: "verbose", description: "Print detailed index diagnostics" }
  ];
}

/** Supports the init options helper. */
function initOptions() {
  return [
    { name: "storage", takesValue: true, values: ["user-global", "repo-local-private"], description: "Storage mode" },
    { name: "repo-local", description: "Use repo-local private output" },
    { name: "scope", takesValue: true, values: ["private", "global", "repo-shared"], description: "Config scope" },
    { name: "base-dir", takesValue: true, description: "Override search output directory" },
    { name: "db-path", takesValue: true, description: "Override SQLite DB path" },
    { name: "language", takesValue: true, values: languageValues, description: "Default languages" },
    { name: "include-generated", description: "Include generated files by default" },
    { name: "mode", takesValue: true, values: modeValues, description: "Default search mode" },
    { name: "max-results", takesValue: true, description: "Default max result count" }
  ];
}
