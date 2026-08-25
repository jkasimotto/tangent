import type { CliCommandSpec } from "@tangent/core";

const serverOption = { name: "server", takesValue: true, description: "Agent Shell server URL (default http://127.0.0.1:4321, or TANGENT_SHELL_URL)" };
const jsonOption = { name: "json", description: "Print machine-readable JSON" };

export const handoverCommandSpec: CliCommandSpec = {
  name: "handover",
  description: "Report this worker's facts to its controlling Area brain; the brain chooses the next action",
  args: "<facts...>",
  options: [
    { name: "session", takesValue: true, description: "Worker session name; defaults to the tmux session this command runs in" },
    serverOption
  ]
};

export const harnessCommandSpec: CliCommandSpec = {
  name: "harness",
  description: "List the machine harness catalog and resolved Area launch defaults",
  subcommands: [
    {
      name: "list",
      description: "List valid harness, model, and effort ids; with --area, include its resolved work and brain defaults",
      options: [
        { name: "area", takesValue: true, description: "Area whose inherited work and brain defaults to resolve" },
        serverOption,
        jsonOption
      ]
    }
  ]
};

export const areaCommandSpec: CliCommandSpec = {
  name: "area",
  description: "List, inspect, and create Tangent tree Areas",
  subcommands: [
    { name: "list", description: "List every Area path in the vault", options: [serverOption, jsonOption] },
    { name: "show", description: "Show one Area's purpose, Goals, and ideas", args: "<area>", options: [serverOption, jsonOption] },
    {
      name: "create",
      description: "Create a nested Area under a parent, with its note, committed with provenance. Only for a durable subject; a result is a Goal.",
      args: "<parent> <name>",
      options: [serverOption, jsonOption]
    },
    { name: "done", description: "Mark an Area done on Julian's word: it folds away from the desk and the tree; its Goals are not changed", args: "<area>", options: [serverOption] },
    { name: "reopen", description: "Reopen a done Area", args: "<area>", options: [serverOption] }
  ]
};

export const brainCommandSpec: CliCommandSpec = {
  name: "brain",
  description: "The Area brain: the long-lived agent that plans and dispatches an Area's work",
  subcommands: [
    {
      name: "advance",
      description: "Start one pending assignment after you have read the prior worker handover.",
      args: "<goal> <step>",
      options: [serverOption]
    },
    {
      name: "request",
      description: "Create one plan, decision, test, or approval request for Julian.",
      options: [
        { name: "kind", takesValue: true, description: "plan, decision, test, or approval" },
        { name: "subject", takesValue: true, description: "Short request subject" },
        { name: "question", takesValue: true, description: "The question, ending in ?" },
        { name: "proposal", takesValue: true, description: "The exact transition that Approve applies" },
        { name: "detail", takesValue: true, description: "At most two short sentences that Julian needs to answer" },
        { name: "option", takesValue: true, description: "Decision choice; repeat for each choice" },
        { name: "goal", takesValue: true, description: "Goal slug this request is about; approval of a test request closes this Goal" },
        { name: "session", takesValue: true, description: "Brain session; defaults to the current tmux session" },
        serverOption
      ]
    },
    {
      name: "handover",
      description: "Hand this brain's facts to a fresh copy of itself: the next generation starts from the plan and these facts, and this session ends.",
      args: "<facts...>",
      options: [
        { name: "session", takesValue: true, description: "Brain session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    },
    {
      name: "withdraw",
      description: "Withdraw one obsolete open Request from Julian's desk.",
      args: "<request-id>",
      options: [
        { name: "note", takesValue: true, description: "Short reason for the withdrawal" },
        { name: "session", takesValue: true, description: "Brain session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    },
    {
      name: "status",
      description: "Show the brain of an Area, or of the session this command runs in: status, generation, instruction, latest handover",
      args: "[area]",
      options: [
        { name: "session", takesValue: true, description: "Brain session name; defaults to the tmux session this command runs in" },
        serverOption,
        jsonOption
      ]
    }
  ]
};

export const shellCommandSpec: CliCommandSpec = {
  name: "shell",
  description: "Agent Shell itself: rebuild and restart the running server",
  subcommands: [
    {
      name: "rebuild",
      description: "Rebuild the packages, restart the Agent Shell server, and return when the new boot answers. Run it before a Test line, so the keys work the first time.",
      options: [
        serverOption,
        { name: "timeout", takesValue: true, description: "Seconds to wait for the new boot (default 240)" }
      ]
    }
  ]
};

export const studyCommandSpec: CliCommandSpec = {
  name: "study",
  description: "Start the study partner: an interactive agent session that explores a codebase with Julian, beside nvim",
  subcommands: [
    { name: "contract", description: "Print the partner's contract (the system prompt the launcher appends)" }
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
        { name: "assignee", takesValue: true, description: "Person from the Area roster; repeatable" },
        { name: "subgoal-title", takesValue: true, description: "Subgoal title; pair with --subgoal-done-when, repeatable" },
        { name: "subgoal-done-when", takesValue: true, description: "Subgoal done condition; pairs with --subgoal-title, repeatable" },
        { name: "own", description: "Take ownership in the same step; the calling agent's session becomes the Goal's session" },
        { name: "session", takesValue: true, description: "Caller session, and owning session for --own; defaults to the current tmux session when available" },
        serverOption,
        jsonOption
      ]
    },
    { name: "list", description: "List Goals, optionally scoped to one Area", args: "[area]", options: [serverOption, jsonOption] },
    { name: "show", description: "Show one Goal's status, done condition, and state", args: "<slug>", options: [serverOption, jsonOption] },
    {
      name: "depend",
      description: "Record advisory Goal prerequisites without blocking or reordering work",
      args: "<slug>",
      options: [
        { name: "on", takesValue: true, description: "Prerequisite Goal slug; repeatable" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "undepend",
      description: "Remove advisory Goal prerequisites",
      args: "<slug>",
      options: [
        { name: "on", takesValue: true, description: "Prerequisite Goal slug; repeatable" },
        serverOption,
        jsonOption
      ]
    },
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
        { name: "session", takesValue: true, description: "Caller session; defaults to the current tmux session when available" },
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
      description: "Hand this step's facts to the next agent in the pipeline, or, with --continue, to a fresh copy of yourself on the same step. State facts only: paths, what changed, what is unresolved.",
      args: "<facts...>",
      options: [
        { name: "session", takesValue: true, description: "The step's session name; defaults to the tmux session this command runs in" },
        { name: "continue", description: "Hand this step to a fresh copy of yourself; the step continues, the pipeline does not advance" },
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

export const documentCommandSpec: CliCommandSpec = {
  name: "document",
  description: "List and resolve Julian's comments inside a vault Document",
  subcommands: [
    { name: "comments", description: "List the open comments of one Document", args: "<file>", options: [serverOption, jsonOption] },
    {
      name: "resolve",
      description: "Remove exactly one comment, matched by its first words, in its own named commit. Use it only after the work is done or Julian said to close it. Requires -m \"<what changed>\".",
      args: "<file> <first words...>",
      options: [
        { name: "session", takesValue: true, description: "Session for the commit trailer; defaults to the tmux session this command runs in" },
        serverOption
      ]
    }
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
