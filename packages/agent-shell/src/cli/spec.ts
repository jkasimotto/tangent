import type { CliCommandSpec } from "@tangent/core";

const serverOption = { name: "server", takesValue: true, description: "Agent Shell server URL (default http://127.0.0.1:4321, or TANGENT_SHELL_URL)" };
const jsonOption = { name: "json", description: "Print machine-readable JSON" };

export const areaCommandSpec: CliCommandSpec = {
  name: "area",
  description: "List and inspect Tangent tree Areas",
  subcommands: [
    { name: "list", description: "List every Area path in the vault", options: [serverOption, jsonOption] },
    { name: "show", description: "Show one Area's purpose, Goals, and ideas", args: "<area>", options: [serverOption, jsonOption] }
  ]
};

export const goalCommandSpec: CliCommandSpec = {
  name: "goal",
  description: "Create, list, start, append to, hand over, and close Goals in the Tangent tree",
  subcommands: [
    {
      name: "create",
      description: "Create a Goal, optionally with Subgoals",
      options: [
        { name: "area", takesValue: true, description: "Owning Area path (required)" },
        { name: "title", takesValue: true, description: "Goal title (required)" },
        { name: "done-when", takesValue: true, description: "Done condition (required)" },
        { name: "description", takesValue: true, description: "Why this Goal exists" },
        { name: "source", takesValue: true, description: "Vault-relative source Document; repeatable" },
        { name: "subgoal-title", takesValue: true, description: "Subgoal title; pair with --subgoal-done-when, repeatable" },
        { name: "subgoal-done-when", takesValue: true, description: "Subgoal done condition; pairs with --subgoal-title, repeatable" },
        { name: "own", description: "Take ownership in the same step; the calling agent's session becomes the Goal's session" },
        { name: "session", takesValue: true, description: "Owning session name for --own; defaults to the tmux session this command runs in" },
        serverOption,
        jsonOption
      ]
    },
    { name: "list", description: "List Goals, optionally scoped to one Area", args: "[area]", options: [serverOption, jsonOption] },
    { name: "show", description: "Show one Goal's status, done condition, and state", args: "<slug>", options: [serverOption, jsonOption] },
    {
      name: "own",
      description: "Take ownership of one or more Goals; they flip to active on this session. Never steals from a live session.",
      args: "<slug...>",
      options: [
        { name: "session", takesValue: true, description: "Owning session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    },
    {
      name: "release",
      description: "Hand owned Goals back to open without ending the session",
      args: "<slug...>",
      options: [
        { name: "session", takesValue: true, description: "Owning session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    },
    {
      name: "start",
      description: "Start an agent on a Goal, or a pipeline of steps. Each --step pairs with the --launch and --continue-from in the same position.",
      args: "<slug>",
      options: [
        { name: "step", takesValue: true, description: "One step's instruction, in your words; repeatable, steps run in order" },
        { name: "launch", takesValue: true, description: "Harness for the step at the same position as <harness[/model[/effort]]>; repeatable; missing means the Area default" },
        { name: "continue-from", takesValue: true, description: "Step number whose session the step at the same position continues, or - for a fresh session; repeatable" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "append",
      description: "Add steps to the end of a Goal's pipeline, mid-run or finished, without restarting what already ran. Same --step, --launch, and --continue-from pairing as start.",
      args: "<slug>",
      options: [
        { name: "step", takesValue: true, description: "One new step's instruction, in your words; repeatable, steps run in order after the existing ones" },
        { name: "launch", takesValue: true, description: "Harness for the step at the same position as <harness[/model[/effort]]>; repeatable; missing means the Area default" },
        { name: "continue-from", takesValue: true, description: "Step number whose session the step at the same position continues, or - for a fresh session; repeatable" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "handover",
      description: "Hand this step's facts to the next agent in the pipeline. State facts only: paths, what changed, what is unresolved.",
      args: "<facts...>",
      options: [
        { name: "session", takesValue: true, description: "The step's session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    },
    {
      name: "done",
      description: "Mark a Goal done. Run only on Julian's explicit word. Status is written on the user's say-so.",
      args: "<slug>",
      options: [serverOption]
    },
    {
      name: "wont-do",
      description: "Mark a Goal won't do with a reason. Run only on Julian's explicit word. Status is written on the user's say-so.",
      args: "<slug>",
      options: [{ name: "reason", takesValue: true, description: "Why this Goal won't be done (required)" }, serverOption]
    }
  ]
};

export const ideaCommandSpec: CliCommandSpec = {
  name: "idea",
  description: "Capture and list ideas on an Area note",
  subcommands: [
    { name: "add", description: "Save an idea to an Area's Ideas and open questions", args: "<area> <text...>", options: [serverOption] },
    { name: "list", description: "List ideas, optionally scoped to one Area", args: "[area]", options: [serverOption, jsonOption] }
  ]
};

export const agentCommandSpec: CliCommandSpec = {
  name: "agent",
  description: "List live agents and send messages between them",
  subcommands: [
    { name: "list", description: "List live agent sessions with their states and queued messages", options: [serverOption, jsonOption] },
    {
      name: "send",
      description: "Send a message to another agent; it delivers when that agent's composer is empty",
      args: "<name> <text...>",
      options: [
        { name: "from", takesValue: true, description: "Sender session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    }
  ]
};

export const vaultCommandSpec: CliCommandSpec = {
  name: "vault",
  description: "Commit vault edits directly with the required provenance trailers",
  subcommands: [
    {
      name: "commit",
      description: "Commit exactly the given vault-relative paths",
      args: "<paths...>",
      options: [
        { name: "area", takesValue: true, description: "Trailer Area override; defaults to the first path's Area directory" }
      ]
    }
  ]
};
