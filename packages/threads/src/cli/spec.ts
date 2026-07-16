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
      description: "Print the generated threads.md (or sidecar JSON with --json)",
      options: [{ name: "json", description: "Print the sidecar JSON" }]
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
      description: "Print the tmux attach command for a registered thread",
      args: "<slug>"
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
