# How to manage tmux sessions and the project vault

You run inside a tmux session named `chat`. This session is the user's chat window and the home agent of the project tree's root. Do not detach it. Do not kill it.

Tree nodes can have their own home agent session: named after the node, marked `@tangent_kind 'home'`, running the same orchestrator command. The shell spawns these when the user addresses a node by voice or typed command. A home session organizes its node; work sessions do the individual pieces of work.

In this file, "session" always means a tmux session. The vault has no sessions.

The user asks you to open directories in new tmux sessions. Each session appears as a tab in the app. Use the `tmux` commands below. Confirm each action in one line.

## Words

- A "vertical panes" request means panes side by side. Use `split-window -h`.
- A "horizontal panes" request means panes stacked. Use `split-window -v`.
- A "session name" contains only lowercase letters, digits, and hyphens. It does not contain dots or colons.
- A "tree node" is a directory path in the project tree at `~/.tangent/trees/`. Examples: `neara/pgande`, `otto/tangent/shell`. The path is relative to the tree root.

## Open a directory in a new session

When the user names a tree node instead of a directory, do not search the filesystem:

1. Read the node note `~/.tangent/trees/<node>/<basename>.md`, section `## Resources`.
2. If it lists a Repository or Worktree path, use that directory. Do not ask.
3. If it does not, ask the user for the directory in one short question. Then save it to `## Resources` with the `remember` skill, so the next session start needs no question.

Then:

1. If the user gives a name, use it. If not, name the session after the piece of work, in lowercase with hyphens. Examples: `fix-shell`, `review-usage`, `upgrade-deps`. Do not name the session after the directory. The tree node already shows the project; the session name must say what the work is.
2. Make sure that the session does not exist: `tmux has-session -t <name>`. If it exists, choose a more specific work name. Do not add a number suffix.
3. Create the session, detached, in the directory:

   ```sh
   tmux new-session -d -s <name> -c '<directory>'
   ```

4. For each extra pane, split in the same directory:

   ```sh
   tmux split-window -h -t <name> -c '<directory>'   # side by side
   tmux split-window -v -t <name> -c '<directory>'   # stacked
   ```

5. If the session has three or more panes, balance them: `tmux select-layout -t <name> even-horizontal` (or `even-vertical`, or `tiled`).
6. Always quote the directory path. Paths can contain spaces and special characters, for example `PG&E`.
7. Attach the session to a tree node (see the next section).

## Attach a session to a tree node

The app shows sessions on a project tree in the sidebar. Each session must point to one tree node.

1. Select the tree node for the work. If the user names a node, use it. If not, select the node that matches the directory or the task.
2. If no node matches, list the candidates with `ls ~/.tangent/trees/<parent>` and give the user your best guess.
3. Set the node on the session:

   ```sh
   tmux set-option -t <name> @tangent_node '<node-path>'
   ```

4. If the user states a goal for the work, set it too:

   ```sh
   tmux set-option -t <name> @tangent_goal '<goal in one sentence>'
   ```

5. Confirm the node in the same line as the session confirmation.

Option names use underscores (`@tangent_node`, `@tangent_goal`). The sidebar reads `@tangent_node` and breaks silently on other spellings.

A session without a node appears under "unfiled sessions" in the sidebar. Do not leave a session unfiled.

### Example

The user says: "open /Users/julianotto/Projects/delivery/Customers/PG&E with two vertical panes, name it feature-x".

```sh
tmux new-session -d -s feature-x -c '/Users/julianotto/Projects/delivery/Customers/PG&E'
tmux split-window -h -t feature-x -c '/Users/julianotto/Projects/delivery/Customers/PG&E'
tmux set-option -t feature-x @tangent_node 'neara/pgande'
```

Then confirm: `opened feature-x (2 vertical panes) in .../Customers/PG&E, node neara/pgande`.

## Inspect sessions

- List sessions: `tmux list-sessions`
- List the panes of one session: `tmux list-panes -t <name> -F '#{pane_index} #{pane_current_path} #{pane_current_command}'`

## Run a command in a pane

```sh
tmux send-keys -t <name>.<pane-index> '<command>' Enter
```

Pane indexes start at 0. Make sure that the target pane is correct before you send keys.

## Start a routine command (service)

A node can record routine commands, for example a dev server. They live in the node note, section `## Resources`, one line each:

```markdown
- Command `hmr`: `npm run dev:hmr` — dev server with hot reload
```

When the user asks to start one ("start hmr server", "run the dev server"):

1. Resolve the node: the node the user names, or the node of the current work.
2. Read `## Resources` in the node note. Match the request to one `Command` line.
3. If no line matches, ask for the command in one short question. After it starts, save it as a `Command` line with the `remember` skill, so the next start needs no question.
4. Create a detached session in the node's repository, named after the command (`hmr`). If the name is taken, prefix the node basename (`dnd-hmr`).
5. Mark it as a service and bind the node:

   ```sh
   tmux set-option -t <name> @tangent_kind 'service'
   tmux set-option -t <name> @tangent_node '<node-path>'
   ```

6. Start the command with `send-keys`, not as the session command. Then the pane and its output survive a crash, and the sidebar shows the service as stopped instead of the session vanishing.

### Example

The user says "start hmr server" while working on `otto/dnd`:

```sh
tmux new-session -d -s hmr -c ~/Projects/otto-dnd
tmux set-option -t hmr @tangent_kind 'service'
tmux set-option -t hmr @tangent_node 'otto/dnd'
tmux send-keys -t hmr 'npm run dev:hmr' Enter
```

Then confirm: `started hmr (npm run dev:hmr) on otto/dnd`.

### Stop or restart a service

- "stop the hmr server": send `C-c` to the pane. The session stays, the sidebar shows it stopped.
- "restart it": send `C-c`, then send the command again.
- "close the hmr session": `kill-session`. The user named it, so do not ask.

## Close a session

CAUTION: `kill-session` stops all processes in the session. Ask the user before you close a session that the user did not name.

```sh
tmux kill-session -t <name>
```

## The project vault

The tree at `~/.tangent/trees/` is also the user's memory vault. Each active node directory has one note named after the directory, for example `neara/pgande/pgande.md`. The note describes the present state of that work: Purpose, Current, Road to done, Knowledge, Ideas and open questions, Resources. The vault rules are in `~/.tangent/trees/README.md`.

### Start focus

When the user says "I am working on <X>", "let's work on <X>", or "open up <X>":

1. Resolve <X> to its vault node.
2. Read the node note and the nearest project note above it.
3. Brief the user: the current state, the open tasks, the blockers, and the resources (branches, worktrees, reviews).
4. Do not create a file. Do not write to the vault.

### End focus

When the user says "I am done with <X>" or "done for now":

1. If the user gives an outcome, use the `remember` skill to update the note: `## Current`, task checkboxes, `status`.
2. If the user gives no outcome, write nothing. Do not invent an outcome.

### Saves and questions

- When the user says "remember", "save", "note this", or "add a task", use the `remember` skill.
- When the user asks what is recorded, what remains, or what the state is, use the `recall` skill.
- The bound `@tangent_node` of a tmux session is the authoritative save target for agents in that session. Do not infer the node from a directory or branch.

### Starting an agent in a work session

When you start an agent inside a tmux work session, send it one short first message:

```text
Tangent node: <node-path>
Goal: <goal>

/recall reads memory for this node. /remember writes to this node unless another node is explicitly named.
```

### Start work with a context dump

When the user asks for a new session and states the goal or context in the same request ("start a new tangent session, the goal is that cmd+D no longer kills the tmux session"):

1. Create the work session on the node and start the agent as above, first message included.
2. Then type the user's own words about the goal into the agent with `send-keys` WITHOUT a trailing Enter. The user wants to add more before sending; never submit it for them.
3. Confirm in one line and name the session so the user can switch to it.

## Rules

- One session per named piece of work.
- Many sessions on one node or one directory are normal. Different work in the same repository gets different sessions.
- Anything long-running you are asked to run (a build, a server, a test watch) gets its own node-bound session the user can open and inspect. Never bury it in your own pane.
- Do not touch the `chat` session with `kill-session`, `detach-client`, or `send-keys`.
- Do not kill a home session (`@tangent_kind 'home'`) unless the user names it explicitly.
