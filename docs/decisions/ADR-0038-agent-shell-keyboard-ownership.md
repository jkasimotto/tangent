# ADR-0038: One visible Agent Shell surface owns each key

Date: 2026-08-27

Status: accepted

## Context

Agent Shell previously handled keyboard events in one global sequence. Work shortcuts could run behind a terminal, modal, picker, or text editor.

The embedded terminal also had shell-specific behavior. A resize race could attach tmux at 80 columns by 24 rows.

Pointer controls and key help used separate labels. They could drift apart and hide important actions.

Documents had comment controls, but they did not provide a complete keyboard reading mode.

## Decision

One context owns each keyboard event. The priority is:

1. blocking modal;
2. Go To;
3. quick Document;
4. terminal session;
5. transient surface;
6. staged Area Focus;
7. text entry;
8. the current Work or Document view;
9. global chrome.

IME composition and dead keys always stay with their input owner.

A terminal session gives command keys to xterm and tmux. The visible `Command-J` action leaves the terminal. `Command-C` copies a visible terminal selection. `Shift-Enter` sends the Meta-Enter byte sequence that embedded tmux preserves as a composer newline. Agent Shell cannot run Work commands behind the terminal.

The terminal waits for a positive measured row and column proposal before it connects. The first PTY size therefore matches the visible frame.

Work uses one open-Goal projection. Current and Planned are row states, not separate views.

One Work command registry owns each command's key, label, scope, help text, and accessible shortcut. Keyboard dispatch and pointer teaching read that registry.

One shared back operation owns pointer Back and browser-managed Escape. It removes one visible stage and restores its opener.

Each child surface registers its parent, opener, draft policy, and focus-restoration target with that operation. Back removes exactly one layer. A handled child Back cannot fall through into Work or global navigation.

The same operation drives the visible Back control. A screen cannot implement a pointer parent that differs from its Escape parent.

Escape never saves or submits. A registry editor keeps its unsaved draft in memory until Julian saves or discards it.

The terminal is the deliberate Back exception. Tmux owns Escape, and the visible `Command-J` action leaves the terminal.

Escape unwinds only the top Work constraint. It closes a transient surface, cancels staged Focus, clears selection, clears search, or clears applied Focus.

Brain, Goal, and default launch use one keyboard chooser. Tab stays inside it until it closes.

`j`, `k`, and vertical arrows move within one choice column. `h`, `l`, and horizontal arrows move between columns.

Enter selects the focused choice. Escape cancels an inner edit, then closes the chooser and restores the exact Work row.

`Shift-[` and `Shift-]` move between real Area headers. The same command records provide visible pointer actions.

The full Document reader has a normal reading mode. It supports Vim movement, history, heading movement, comment movement, comment creation, contextual help, and staged Escape.

Text fields and comment composers own their normal editing keys. `Command-Enter` submits only a surface that displays that action.

## Consequences

A visible surface cannot mutate a lower surface through a leaked key.

The terminal behaves like the same tmux client at the browser boundary. Agent Shell does not create a second terminal command language.

Every registered Work command has one source for its keyboard and pointer presentation. Tests can prove both paths from the same command identity.

Document reading stays fast without breaking native selection or text editing.

Adding a new shortcut requires an owner, a pointer path, accessible metadata, and an overlap test.

Adding a child screen requires one adapter in the shared back router. Pointer Back and Escape cannot choose different parents.

Tests for a child screen must cover Escape, the visible Back action, draft retention, and restoration of its exact opener.
