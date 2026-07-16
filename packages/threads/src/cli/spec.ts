import type { CliCommandSpec } from "@tangent/core";

export const threadsCommandSpec: CliCommandSpec = {
  name: "threads",
  description: "Delegated-thread sweep, registry, and attach",
  subcommands: [
    {
      name: "sweep",
      description: "Scan the vault, derive thread states, render threads.md, and notify",
      options: [
        { name: "json", description: "Print the sidecar JSON" },
        { name: "dry-run", description: "Print the would-be threads.md and notifications without writing, notifying, or calling the model" },
        { name: "no-model", description: "Skip the haiku why-line pass and use templated why-lines only" }
      ]
    },
    {
      name: "list",
      description: "Print the generated threads.md, optionally filtered to a vault subtree (or sidecar JSON with --json)",
      args: "[subtree]",
      options: [
        { name: "json", description: "Print the sidecar JSON" },
        { name: "node", takesValue: true, description: "Subtree filter (same as the positional arg, e.g. neara or neara/pgande)" }
      ]
    },
    {
      name: "register",
      description: "Upsert a dispatched thread's worktree/tmux/session linkage into the registry",
      args: "<slug>",
      options: [
        { name: "node", takesValue: true, description: "Vault node path (e.g. neara/pgande)" },
        { name: "worktree", takesValue: true, description: "Absolute worktree path" },
        { name: "tmux", takesValue: true, description: "tmux session name" },
        { name: "session", takesValue: true, description: "Claude session id (optional; resolved by worktree cwd on the next sweep if omitted)" }
      ]
    },
    {
      name: "attach",
      description: "Open a registered thread's tmux session in a new full-screen iTerm window (worker left, nvim right)",
      args: "<slug>",
      options: [{ name: "print", description: "Print the manual tmux attach command instead of opening iTerm" }]
    },
    {
      name: "milestone",
      description: "Render a node's milestone file: project view (default), Slack update text (--slack), or copy the update to the clipboard rich+plain (--copy)",
      args: "<node>",
      options: [
        { name: "slack", description: "Print the paste-ready Slack update text instead of the project view" },
        { name: "copy", description: "Put the Slack update on the clipboard with HTML and plain-text flavors" }
      ]
    },
    {
      name: "recur",
      description: "Run scheduled recurring dispatch definitions (recur-<slug>.md)",
      subcommands: [
        {
          name: "due",
          description: "Run every recur definition that is currently due",
          options: [{ name: "dry-run", description: "Print what would run without launching or recording" }]
        },
        {
          name: "run",
          description: "Run one recur definition regardless of due-ness",
          args: "<slug>",
          options: [{ name: "dry-run", description: "Print what would run without launching or recording" }]
        }
      ]
    }
  ]
};
