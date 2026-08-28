# Area star focus: user intent

Date: 2026-08-28

This note keeps Julian's request before the design turns it into details. It extends `../agent-shell-work-contract/user-intent.md`.

## Julian's words

"I also need a way to quickly hide areas as I navigate around. Kind of the inverse of focus actually. or rather I need a way to use the keyboard shortcuts to select areas to focus. If i focus one maybe it shows a star and theres some way (again using mostly the keyboard but also a mouse way) of showing only the focused areas."

## What this means

- Selecting Areas for Focus must happen from the row the cursor is on, with one key. Today it happens in a separate picker.
- A focused Area shows a star on its row.
- One control, keyboard first with a mouse equivalent, switches Work between all Areas and the starred Areas only.
- "Hide as I navigate" is the same need from the other side: when only starred Areas show, removing a star hides that Area.
