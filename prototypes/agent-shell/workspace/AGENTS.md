# How to manage tmux sessions

You run inside a tmux session named `chat`. This session is the user's chat window. Do not detach it. Do not kill it.

The user asks you to open directories in new tmux sessions. Each session appears as a tab in the app. Use the `tmux` commands below. Confirm each action in one line.

## Words

- A "vertical panes" request means panes side by side. Use `split-window -h`.
- A "horizontal panes" request means panes stacked. Use `split-window -v`.
- A "session name" contains only lowercase letters, digits, and hyphens. It does not contain dots or colons.
- A "tree node" is a directory path in the project tree at `~/.tangent/trees/`. Examples: `neara/pgande`, `otto/tangent/shell`. The path is relative to the tree root.

## Open a directory in a new session

1. If the user gives a name, use it. If not, use the directory basename in lowercase with hyphens.
2. Make sure that the session does not exist: `tmux has-session -t <name>`. If it exists, tell the user and stop.
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

4. Confirm the node in the same line as the session confirmation.

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

## Close a session

CAUTION: `kill-session` stops all processes in the session. Ask the user before you close a session that the user did not name.

```sh
tmux kill-session -t <name>
```

## Rules

- One session per named piece of work.
- Do not create a session that duplicates an open session for the same directory. Tell the user which session already has that directory.
- Do not touch the `chat` session with `kill-session`, `detach-client`, or `send-keys`.
