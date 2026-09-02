import type { CliCommandSpec } from "@tangent/core";

const serverOption = { name: "server", takesValue: true, description: "Agent Shell server URL (default http://127.0.0.1:4321, or TANGENT_SHELL_URL)" };
const jsonOption = { name: "json", description: "Print machine-readable JSON" };

export const sendCommandSpec: CliCommandSpec = {
  name: "send",
  description: "Send a plain note to a live session or an Area brain's durable inbox",
  args: "<session|area> <note...>",
  options: [
    { name: "session", takesValue: true, description: "Sender session name; defaults to the tmux session this command runs in" },
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
    { name: "list", description: "List every open Area path in the vault; done and archived Areas fold away", options: [{ name: "all", description: "Include done and archived Areas, each with its status" }, serverOption, jsonOption] },
    { name: "show", description: "Show one Area's purpose, resources, skills, and processes", args: "<area>", options: [serverOption, jsonOption] },
    { name: "recent", description: "Show material milestones for one Area and its child Areas", args: "<area>", options: [{ name: "since", takesValue: true, description: "Only milestones inside a window (30d, 12h, 2w, 90m) or after an ISO time" }, { name: "query", takesValue: true, description: "Only milestones whose summary or reference holds any of these words" }, { name: "limit", takesValue: true, description: "Maximum rows (default 12)" }, serverOption, jsonOption] },
    { name: "audit", description: "Export detached legacy Area-brain records for explicit audit", args: "<area>", options: [serverOption, jsonOption] },
    { name: "present", description: "Present an Area Document without a Goal", args: "<area> <file>...", options: [{ name: "note", takesValue: true, description: "Short reason to read it" }, { name: "withdraw", description: "Withdraw one presented Document" }, { name: "session", takesValue: true, description: "Calling brain session" }, serverOption] },
    { name: "picture", description: "Present the exact Area brain's structured picture", args: "<area>", options: [{ name: "file", takesValue: true, description: "Validated area-picture JSON file" }, { name: "withdraw", description: "Withdraw the current picture" }, { name: "hash", takesValue: true, description: "Expected picture hash when withdrawing" }, { name: "session", takesValue: true, description: "Calling brain session" }, serverOption] },
    { name: "propose", description: "Propose a referenced map block without placing it", args: "<area>", options: [{ name: "source", takesValue: true, description: "Vault file with optional #subpath" }, { name: "link", takesValue: true, description: "HTTP or HTTPS URL" }, { name: "note", takesValue: true, description: "Why this block belongs" }, { name: "withdraw", takesValue: true, description: "Proposal ID to withdraw" }, { name: "version", takesValue: true, description: "Expected proposal version" }, { name: "session", takesValue: true, description: "Calling brain session" }, serverOption] },
    { name: "promote", description: "Attach the durable result of an ink promotion", args: "<area>", options: [{ name: "complete", takesValue: true, description: "Promotion operation ID" }, { name: "source", takesValue: true, description: "Created vault file with optional #subpath" }, { name: "notice", takesValue: true, description: "Durable brain notice ID" }, { name: "session", takesValue: true, description: "Calling brain session" }, serverOption] },
    {
      name: "create",
      description: "Create a nested Area under a parent, with its note, committed with provenance. Only for a durable subject; a result is a Goal.",
      args: "<parent> <name>",
      options: [serverOption, jsonOption]
    },
    { name: "done", description: "Mark an Area done on Julian's word: a finished subject folds away from the desk and the tree; its Goals are not changed", args: "<area>", options: [serverOption] },
    { name: "archive", description: "Archive an Area on Julian's word: a shelved subject folds away from the desk and the tree; its Goals are not changed", args: "<area>", options: [serverOption] },
    { name: "reopen", description: "Reopen a done or archived Area", args: "<area>", options: [serverOption] }
  ]
};

const areaOption = { name: "area", takesValue: true, description: "Only this Area and the Areas inside it" };

export const processCommandSpec: CliCommandSpec = {
  name: "process",
  description: "Create and manage repeatable work and brain loops: <area>/process-<slug>.md notes",
  subcommands: [
    { name: "create", description: "Create and commit one loop note", options: [{ name: "area", takesValue: true, description: "Area that owns the loop" }, { name: "slug", takesValue: true, description: "Lowercase kebab-case loop identity" }, { name: "every", takesValue: true, description: "Loop interval (1m or slower)" }, { name: "message", takesValue: true, description: "Message for the Area brain" }, serverOption, jsonOption] },
    { name: "list", description: "List every process with its schedule, next run, and state", args: "[area]", options: [areaOption, serverOption, jsonOption] },
    { name: "show", description: "Show one process: schedule or probe, next run, last run, last Goal", args: "<slug|area/slug>", options: [areaOption, serverOption, jsonOption] },
    { name: "start", description: "Accept and start the current Process event (exact Area brains only)", args: "<slug|area/slug>", options: [{ name: "event", takesValue: true, description: "Expected event ID" }, { name: "attempt", takesValue: true, description: "Delivered attempt ID" }, { name: "definition", takesValue: true, description: "Expected Process definition digest" }, { name: "operation-id", takesValue: true, description: "Stable retry identity" }, areaOption, serverOption, jsonOption] },
    { name: "pause", description: "Set status: paused in the note and commit it", args: "<slug|area/slug>", options: [areaOption, serverOption, jsonOption] },
    { name: "resume", description: "Set status: active in the note and commit it", args: "<slug|area/slug>", options: [areaOption, serverOption, jsonOption] },
    { name: "check", description: "Evaluate due-ness now and print why", args: "<slug|area/slug>", options: [areaOption, serverOption, jsonOption] },
    { name: "dismiss", description: "Dismiss the exact current occurrence without changing its definition", args: "<slug|area/slug>", options: [{ name: "event", takesValue: true, description: "Expected occurrence ID" }, { name: "revision", takesValue: true, description: "Expected Process revision" }, { name: "operation-id", takesValue: true, description: "Stable retry identity" }, areaOption, serverOption, jsonOption] },
    { name: "restore", description: "Restore the exact last dismissed occurrence", args: "<slug|area/slug>", options: [{ name: "event", takesValue: true, description: "Dismissed occurrence ID" }, { name: "revision", takesValue: true, description: "Expected Process revision" }, { name: "operation-id", takesValue: true, description: "Stable retry identity" }, areaOption, serverOption, jsonOption] },
    { name: "remove", description: "Remove one loop note and commit the removal", args: "<slug|area/slug>", options: [areaOption, serverOption, jsonOption] }
  ]
};

export const brainCommandSpec: CliCommandSpec = {
  name: "brain",
  description: "The Area brain: the one long-lived agent that organises an Area's work. It runs until Julian restarts it; the Area note is its memory",
  subcommands: [
    {
      name: "advance",
      description: "Start one pending assignment after you have read the worker note before it.",
      args: "<goal> <step>",
      options: [serverOption]
    },
    {
      name: "request",
      description: "Create one plan, decision, or approval request for Julian. Julian flags what he checks, so there is no test request.",
      options: [
        { name: "kind", takesValue: true, description: "plan, decision, or approval" },
        { name: "subject", takesValue: true, description: "Short request subject" },
        { name: "question", takesValue: true, description: "The question, ending in ?" },
        { name: "proposal", takesValue: true, description: "The exact transition that Approve applies" },
        { name: "detail", takesValue: true, description: "At most two short sentences that Julian needs to answer" },
        { name: "option", takesValue: true, description: "Decision choice; repeat for each choice" },
        { name: "goal", takesValue: true, description: "Goal slug this request is about" },
        { name: "document", takesValue: true, description: "Document for Julian to read; repeatable" },
        { name: "effect", takesValue: true, description: "Exact authorized effect as one JSON object" },
        { name: "session", takesValue: true, description: "Brain session; defaults to the current tmux session" },
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
      description: "Show the brain of an Area, or of the session this command runs in: status, session, founding message, open requests",
      args: "[area]",
      options: [
        { name: "session", takesValue: true, description: "Brain session name; defaults to the tmux session this command runs in" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "stop",
      description: "Stop the exact live brain attempt through Agent Shell ownership fencing. Its Goals remain unchanged.",
      args: "[area]",
      options: [
        { name: "session", takesValue: true, description: "Brain session name; defaults to the tmux session this command runs in" },
        serverOption
      ]
    },
    { name: "succeed", description: "Safely stage and promote the next Brain generation after exact first-message proof", options: [{ name: "session", takesValue: true, description: "Current Brain session; defaults to this tmux session" }, serverOption, jsonOption] }
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
    },
    {
      name: "migrate-launch-policy",
      description: "Create or refresh explicit per-Area harnesses.md contracts without changing effective policy.",
      options: [serverOption, { name: "dry-run", description: "Print the proposed policy and memory changes without writing them" }]
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
  description: "Create, inspect, relate, own, and close Goal intent in the Tangent tree",
  subcommands: [
    {
      name: "present",
      description: "Present Documents or declarative cards on a Goal, or withdraw one",
      args: "<slug> [<file...>]",
      options: [
        { name: "note", takesValue: true, description: "Short reason to read the document" }, { name: "withdraw", description: "Withdraw the named Document" },
        { name: "card", takesValue: true, description: "Card kind: copy, link, links, progress, checklist, commits, or reviews" },
        { name: "title", takesValue: true, description: "Card title" }, { name: "text", takesValue: true, description: "Copy text" },
        { name: "url", takesValue: true, description: "Link URL; repeatable" }, { name: "label", takesValue: true, description: "Link label; repeatable" },
        { name: "step", takesValue: true, description: "Progress <label>:<status>; repeatable" }, { name: "current", takesValue: true, description: "Current 1-based progress step" },
        { name: "item", takesValue: true, description: "Checklist <label>:<done>; repeatable" }, { name: "repo", takesValue: true, description: "Commit repository" },
        { name: "commit", takesValue: true, description: "<hash>:<subject>[:<url>]; repeatable" }, { name: "review", takesValue: true, description: "<id>:<title>:<url>:<state>; repeatable" },
        { name: "withdraw-card", takesValue: true, description: "Withdraw the card with this title" },
        { name: "session", takesValue: true, description: "Caller session; defaults to the current tmux session" }, serverOption]
    },
    {
      name: "create",
      description: "Create a Goal. A brain adds --start to start its worker in the same call",
      options: [
        { name: "area", takesValue: true, description: "Owning Area path (required)" },
        { name: "title", takesValue: true, description: "Goal title (required)" },
        { name: "done-when", takesValue: true, description: "Done condition; defaults to the title" },
        { name: "start", description: "Start a worker on the new Goal at once (brains only)" },
        { name: "path", takesValue: true, description: "Directory the worker runs in; without it the Area's Repository line applies" },
        { name: "launch", takesValue: true, description: "Worker harness as <harness[/model[/effort]]>; without it the brain's own harness is lent" },
        { name: "verify", description: "Julian checks this Goal himself: done becomes Check it. Pass it only when he said so" },
        { name: "instruction", takesValue: true, description: "The worker's instruction, in your words; defaults to the title and done condition" },
        { name: "instruction-file", takesValue: true, description: "Read the worker's instruction from this file" },
        { name: "description", takesValue: true, description: "Why this Goal exists" },
        { name: "source", takesValue: true, description: "Vault-relative source Document; repeatable" },
        { name: "subgoal-title", takesValue: true, description: "Subgoal title; pair with --subgoal-done-when, repeatable" },
        { name: "subgoal-done-when", takesValue: true, description: "Subgoal done condition; pairs with --subgoal-title, repeatable" },
        { name: "own", description: "Take ownership in the same step; the calling agent's session becomes the Goal's session" },
        { name: "session", takesValue: true, description: "Caller session, and owning session for --own; defaults to the current tmux session when available" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "list",
      description: "List Goals, optionally scoped to one Area; --subtree includes its child Areas",
      args: "[area]",
      options: [
        { name: "subtree", description: "Include Goals in child Areas" }, { name: "done", description: "List only done Goals" }, { name: "all", description: "List Goals in every status" }, { name: "status", takesValue: true, description: "Keep only this status; repeatable" },
        { name: "changed-since", takesValue: true, description: "Keep only Goals changed inside a window (30d, 12h, 2w, 90m) or since a date" },
        { name: "query", takesValue: true, description: "Keep Goals whose slug, title, done condition, or Area holds any of these words" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "show",
      description: "Show one Goal's intent, status, done condition, dependencies, Documents, and cards",
      args: "<slug>",
      options: [serverOption, jsonOption],
    },
    {
      name: "depend",
      description: "Record advisory Goal prerequisites without blocking or reordering work",
      args: "<slug>",
      options: [
        { name: "on", takesValue: true, description: "Prerequisite Goal slug; repeatable" },
        { name: "session", takesValue: true, description: "Caller session; defaults to the current tmux session" },
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
        { name: "session", takesValue: true, description: "Caller session; defaults to the current tmux session" },
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
      name: "done",
      description: "Mark a Goal done: Julian's word, or the brain after it read a worker's done note. A Goal flagged verify becomes Check it and waits for Julian.",
      args: "<slug>",
      options: [serverOption]
    },
    {
      name: "wont-do",
      description: "Mark a Goal won't do with a reason, on Julian's word or the brain's plan.",
      args: "<slug>",
      options: [{ name: "reason", takesValue: true, description: "Why this Goal won't be done (required)" }, serverOption]
    },
    {
      name: "park",
      description: "Park a Goal without deleting its notes or execution history",
      args: "<slug>",
      options: [{ name: "reason", takesValue: true, description: "Optional reason for parking the Goal" }, serverOption]
    },
    {
      name: "reopen",
      description: "Return a done, parked, or won't-do Goal to open without starting an agent",
      args: "<slug>",
      options: [serverOption]
    }
  ]
};

export const jobCommandSpec: CliCommandSpec = {
  name: "job",
  description: "Create, inspect, and control durable execution runs for Goals",
  subcommands: [
    { name: "create", description: "Create a Job without starting an Agent", args: "<goal>", options: [
      { name: "step", takesValue: true, description: "Assignment instruction; repeatable" },
      { name: "launch", takesValue: true, description: "Assignment harness as <harness[/model[/effort]]>; repeatable" },
      { name: "path", takesValue: true, description: "Assignment working directory; repeatable" },
      { name: "kind", takesValue: true, description: "implementation or review; repeatable" },
      { name: "continue-from", takesValue: true, description: "Earlier Assignment number, or -; repeatable" },
      { name: "session", takesValue: true, description: "Calling Brain session" }, serverOption, jsonOption,
    ] },
    { name: "show", description: "Show one Job with Assignments, Attempts, and reports", args: "<goal>", options: [{ name: "run", takesValue: true, description: "Historical run number" }, serverOption, jsonOption] },
    { name: "start", description: "Start the first pending Assignment", args: "<goal>", options: [{ name: "session", takesValue: true, description: "Calling Brain session" }, serverOption, jsonOption] },
    { name: "append", description: "Append pending Assignments to the current Job", args: "<goal>", options: [
      { name: "step", takesValue: true, description: "Assignment instruction; repeatable" },
      { name: "launch", takesValue: true, description: "Assignment harness; repeatable" },
      { name: "path", takesValue: true, description: "Assignment working directory; repeatable" },
      { name: "kind", takesValue: true, description: "implementation or review; repeatable" },
      { name: "continue-from", takesValue: true, description: "Earlier Assignment number, or -; repeatable" },
      { name: "session", takesValue: true, description: "Calling Brain session" }, serverOption, jsonOption,
    ] },
    { name: "advance", description: "Start an exact pending Assignment", args: "<goal> <n>", options: [{ name: "session", takesValue: true, description: "Calling Brain session" }, serverOption, jsonOption] },
    { name: "stop", description: "Stop the current Job and leave its Goal open", args: "<goal>", options: [{ name: "session", takesValue: true, description: "Caller session" }, serverOption, jsonOption] },
    { name: "replace", description: "Readiness-gate a new Attempt for one Assignment", args: "<goal>", options: [
      { name: "assignment", takesValue: true, description: "Stable Assignment ID" },
      { name: "launch", takesValue: true, description: "Replacement harness" },
      { name: "expected-attempt", takesValue: true, description: "Current Attempt ID fence" },
      { name: "confirm", description: "Promote a ready replacement" },
      { name: "operation-id", takesValue: true, description: "Stable replacement operation ID" },
      { name: "session", takesValue: true, description: "Calling Brain session" }, serverOption, jsonOption,
    ] },
  ],
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
        { name: "index", takesValue: true, description: "Exact 1-based index from document comments" },
        { name: "session", takesValue: true, description: "Session for the commit trailer; defaults to the tmux session this command runs in" },
        serverOption
      ]
    }
  ]
};

export const styleCommandSpec: CliCommandSpec = {
  name: "style",
  description: "Leave and read writing-style notes; they never reach a Document, its comments, or a notice",
  subcommands: [
    {
      name: "add",
      description: "Record one observation about how a Document's writing went wrong or right. It writes no vault file, makes no commit, and tells nobody.",
      args: "<file> <note...>",
      options: [
        { name: "note", takesValue: true, description: "The observation, when it is not written after the file" },
        { name: "quote", takesValue: true, description: "The exact words the note is about; they are stored whole, so the note survives their rewrite" },
        { name: "tag", takesValue: true, description: "Free-text problem tag; repeat it for several" },
        serverOption,
        jsonOption
      ]
    },
    {
      name: "list",
      description: "Read the corpus back, newest first, with counts by model, harness, tag, and Area",
      options: [
        { name: "area", takesValue: true, description: "Only notes on Documents in this Area or under it" },
        { name: "file", takesValue: true, description: "Only notes on one exact Document" },
        { name: "since", takesValue: true, description: "Only notes written at or after an ISO time" },
        { name: "model", takesValue: true, description: "Only notes whose annotated words were written by this model" },
        { name: "harness", takesValue: true, description: "Only notes whose annotated words were written by this harness" },
        { name: "tag", takesValue: true, description: "Only notes carrying this tag" },
        { name: "limit", takesValue: true, description: "Maximum notes to print (default 40)" },
        serverOption,
        jsonOption
      ]
    },
    { name: "show", description: "Show one style note whole, including the words it quoted", args: "<id>", options: [serverOption, jsonOption] }
  ]
};

export const agentCommandSpec: CliCommandSpec = {
  name: "agent",
  description: "List, inspect, stop, resume, and message live Agent sessions",
  subcommands: [
    { name: "list", description: "List live agent sessions with their states and queued messages", options: [serverOption, jsonOption] },
    { name: "show", description: "Show one live Agent joined to its durable Attempt or Brain generation", args: "<session>", options: [serverOption, jsonOption] },
    { name: "stop", description: "Stop one exact Agent session; a Job Assignment returns to pending", args: "<session>", options: [serverOption, jsonOption] },
    { name: "resume", description: "Open an unbound resume Agent from one historical Attempt", args: "<session>", options: [{ name: "conversation", takesValue: true, description: "Conversation ID when discovery finds more than one" }, serverOption, jsonOption] },
    {
      name: "send",
      description: "Send a note to one exact live Agent session",
      args: "<session> <text...>",
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
