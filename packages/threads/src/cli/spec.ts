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
      name: "status",
      description: "Print the compact statusline badge (slug, reason class, overflow, and staleness)"
    },
    {
      name: "register",
      description: "Upsert a dispatched thread's worktree/tmux/session linkage into the registry",
      args: "<slug>",
      options: [
        { name: "node", takesValue: true, description: "Vault node path (e.g. neara/pgande)" },
        { name: "worktree", takesValue: true, description: "Absolute worktree path" },
        { name: "tmux", takesValue: true, description: "tmux session name" },
        { name: "session", takesValue: true, description: "Claude session id (optional; resolved by worktree cwd on the next sweep if omitted)" },
        { name: "runtime", takesValue: true, description: "Worker runtime: claude (default) or pi" },
        { name: "base", takesValue: true, description: "Base branch used for landed detection and safe branch cleanup" },
        { name: "branch", takesValue: true, description: "Thread branch used for landed detection" },
        { name: "created-worktrees", takesValue: true, description: "Comma-separated worktrees dispatch created" },
        { name: "created-branches", takesValue: true, description: "Comma-separated branches dispatch created" },
        { name: "created-tmux", takesValue: true, description: "Comma-separated tmux sessions dispatch created" },
        { name: "created-cdev", takesValue: true, description: "Comma-separated cdev instances dispatch created" },
        { name: "reused-worktrees", takesValue: true, description: "Comma-separated reused worktrees cleanup must preserve" },
        { name: "reused-branches", takesValue: true, description: "Comma-separated reused branches cleanup must preserve" },
        { name: "reused-tmux", takesValue: true, description: "Comma-separated reused tmux sessions cleanup must preserve" },
        { name: "reused-cdev", takesValue: true, description: "Comma-separated reused cdev instances cleanup must preserve" }
      ]
    },
    {
      name: "validate",
      description: "Record that review and validation staging completed, making a finished thread ready-for-you",
      args: "<slug>",
      options: [
        { name: "verdict", takesValue: true, description: "The precise verdict question for the human" },
        { name: "url", takesValue: true, description: "Fully parameterized validation surface URL" }
      ]
    },
    {
      name: "cleanup",
      description: "Remove only resources registered as created; preserve all reused resources",
      args: "<slug>"
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
