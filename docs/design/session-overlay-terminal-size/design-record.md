# Session overlay terminal size

## Problem contract

The Work overlay fills the viewport, but its terminal can remain at the xterm default size of 80 by 24 cells.

The fix must meet these conditions:

- The terminal fills the available row of the session overlay.
- xterm receives definite host dimensions when it fits the terminal.
- The header, outer margin, and terminal padding remain unchanged.
- Browser resize continues to update the terminal.
- Brain, Goal, definition, and program sessions use the same rule.

The fix does not change tmux window policy or terminal font settings.

## Current system

**Observed:** `.session-layer` and `.session-surface` fill the viewport inside a 38 px outer margin.

**Observed:** `.session-surface` gives its second row all space below the 36 px header.

**Observed:** `.terminal-host` normally uses absolute edges. The session overlay overrides that rule with relative position, auto width, auto height, and margins.

**Observed:** xterm starts at 80 by 24 cells. `FitAddon` derives its size from the terminal host.

**Observed:** the live Portland browser client is 80 by 24 cells. This size matches the visible pane and xterm defaults.

## UI and state analysis

The user opens a brain from Work. The overlay must keep Work visible below it and give the terminal the remaining dialog space.

The host size is derived from the overlay grid. No application state must store terminal width or height.

Empty, loading, reconnecting, and ended terminals use the same host. A definite host size prevents each state from changing the dialog layout.

The existing resize observer remains the authority for later size changes. The CSS layout supplies its input dimensions.

## Candidate designs

### A. Add a delayed second fit

This option can hide the first bad measurement. It does not make the host geometry definite.

This option loses because timing remains part of the layout contract.

### B. Set terminal rows and columns from the viewport

This option bypasses `FitAddon`. It duplicates font and cell measurements in application code.

This option loses because xterm already owns those measurements.

### C. Give the overlay host definite grid-track dimensions

This option sets the host width and height to 100 percent. Padding replaces the current margins inside the same track.

This option wins because layout owns geometry and `FitAddon` keeps ownership of terminal cells.

## Decisions

**Decision:** `.session-layer-terminal` fills both dimensions of its grid track.

**Decision:** The host uses border-box sizing. Its existing inner spacing becomes padding instead of external margins.

**Decision:** The implementation keeps the resize observer and terminal transport unchanged.

**Decision:** A stylesheet contract test protects the definite width, height, and box-sizing rules.

## Risks and assumptions

**Assumption:** the screenshot shows the live 80-column browser tmux client that the local diagnostic command reports.

**Risk:** jsdom does not calculate real grid geometry. The regression test protects the CSS inputs, not a pixel measurement.

## Sources

- `packages/agent-shell/app/public/shell.css`
- `packages/agent-shell/app/public/terminal-controller.js`
- `packages/agent-shell/app/terminal-transport.mjs`
- `packages/agent-shell/app/public/shell.html`
- `packages/agent-shell/app/work-table-ui.test.mjs`
