# 2026-08-07 agent-shell prototype

## What we built

We built the first prototype of agent-shell. The app shows a chat window and embedded terminals in the browser. The chat window is a tmux session named `chat`. This session runs an agent command (`AGENT_CMD`, default `claude`). Each other tmux session appears as a tab. A click on a tab attaches the terminal. The close button detaches the terminal, and the session continues in the background.

## Components

- `server.mjs`: a Node HTTP server with WebSocket support. The server connects each browser terminal to tmux through node-pty. The command `tmux new-session -A` attaches to a session, or creates it when it does not exist. The route `/api/sessions` returns the live tmux sessions.
- `public/index.html`: the frontend, built on xterm.js with the fit addon. The frontend polls `/api/sessions` every two seconds. The chat terminal is the default view.
- `workspace/`: the start directory for the chat agent. This directory contains `.agent/`, `.claude/`, `AGENTS.md`, and `CLAUDE.md`. The file `AGENTS.md` tells the agent how to manage tmux sessions in directories. The file `.claude/settings.json` permits `tmux` commands without prompts.

## Defects that we found and corrected

1. The prebuilt `spawn-helper` binary of node-pty lost the executable bit at install time. The error was `posix_spawnp failed.`. A postinstall script now applies `chmod +x`.
2. The frontend did not send the terminal size after the WebSocket opened. As a result, each session showed at 80x24. The frontend now sends the size in the open handler.
3. The tab bar rebuilt its buttons on each poll. As a result, clicks on tabs failed. The frontend now rebuilds the tab bar only when the session list changes.

## Verification

We drove the app in Chrome. The chat tab ran Claude Code v2.1.224 in the workspace. We created a session named `feature-x` with two side-by-side panes in `~/Projects`. The tab appeared, the terminal attached at full size, and the session survived a detach with both panes.

## How to run

1. Go to `prototypes/agent-shell/`.
2. Do `npm install` one time.
3. Do `npm start`.
4. Open `http://localhost:4321`.

## Next steps

- Decide the scope of the session list. The list currently shows all sessions of the default tmux server.
- Decide the restart behavior for the chat session when the agent command stops.
