# Agent Shell keymap: design record

Date: 2026-08-28. Status: implemented 2026-08-28 for Work, Go To, the Area list, and the reader chords (`motion-keys.js`). Left for a later slice: the registry `surface` field with the reader reading its keys from it (decision 6), the modal and launch chooser through the shared resolver (they already honor the grammar inline), and `PageUp`/`PageDown` in the reader.

Lenses: UI/UX, architecture and state. This record owns every navigation key in Agent Shell. `../agent-shell-work-search/design-record.md` owns the search bar's behavior and reads its keys from here. `../agent-shell-navigation-model/design-record.md` owns the object tree, the verb table, and the layer stack. This record does not change those.

## 1. Problem contract

**Root problem.** Navigation keys grew per surface. Work, the Document reader, Go To, the launch chooser, the modal, the Area list, and the key sheet each bind movement in their own code with their own key sets. `j`/`k` work in Work and the reader but not in Go To. Arrows work in Go To and the Area list but move only DOM focus in Work. `n` means "next comment" in the reader and "capture note" in Work. Three `gg` timers exist. Julian wants Vim movement to be the one grammar, so a key learned on one surface works on every surface.

**Constraints.**

- ADR-0038: one visible surface owns each key; a context-local letter is legal only on a surface that prints it.
- The Work command registry is the one source of keys, labels, help, and `aria-keyshortcuts`. The reader has a second, pure matcher (`document-reading-commands.js`).
- The terminal owns every key except `⌘J` (ADR-0038). No terminal key changes here.
- Browser-reserved keys on macOS stay untouched: `⌘N`, `⌘T`, `⌘W`, `⌘L`, `⌘F`, `⌘R`, `⌘[`, `⌘]`.
- Text fields own letters. Movement inside a text-owned list uses keys that never type.

**Non-goals.**

- Action letters (`b s d a f r o c x`) are out of scope except where they collide with a navigation key. The verb table in the navigation record governs them.
- Vim counts (`3j`), marks, registers, operators, visual mode. See rejected alternatives.
- A user-editable keymap. The 2026-08-07 attempt regrew and was deleted.

**Success conditions.**

1. One printed table (section 5) lists every navigation key. Each key has the same meaning on every surface where it is legal.
2. `j k gg G { } h l / n N Enter Escape` behave the same on Work rows, Go To rows, chooser columns, modal actions, and the reader, with the documented reader differences (line scroll, headings).
3. A text-owned list (Go To input, search bar, Focus picker, Area search) moves with `↓ ↑ Ctrl-N Ctrl-P` and never with letters.
4. One chord engine. One arrow-and-letter row mover in Work.
5. `?` prints the table for the visible surface from the registry, grouped by motion, search, enter and leave, actions.

## 2. Current system (Observed)

Per surface, from the handlers named in section 9.

| Surface | Keys today | Where |
|---|---|---|
| Work rows | `j k`, `gg G`, `{ }`, `h l`, `Enter`, `⌘J`, `/` (filter), `?`, `:` and action letters `b s d a f r n o c x` | `shell-event-bindings.js:2569-2635`, registry `work-commands.js` |
| Work rows, parallel | `↓ ↑ Home End` move DOM focus between title buttons only, no cursor, no paint | `moveBetweenWorkRows`, `:1196` |
| Work chords | own `workPendingG` timer, 650 ms | `:2583-2587` |
| Reader | `j k` scroll a line, `Ctrl-D Ctrl-U` half page, `gg G`, `{ }` headings, `H L` history, `n N` comments, `c e r x` comment lifecycle, `r` resume, `?`, staged `Escape`, `:` Goal actions, `⌘⌥M/N/P` | `document-reading-commands.js:64-90`, `:2643-2660` |
| Reader chords | own `pendingG`, caller-owned timer | `document-reader-controller.js` |
| Key sheet | `gg G` scroll, own `keySheetPendingG` | `:887-889` |
| Go To | `↓ ↑ Enter Escape ⌘K`, no `j k`, no `Ctrl-N/P` | `:2120-2149` |
| Launch chooser | `Tab` trap, `j k ↓ ↑` in a column, `h l ← →` between columns, `Enter Space`, `Escape` | `:393-467` |
| Modal | `j k ↓ ↑` between actions, printed letters, `Enter`, `Escape` | `:2459-2495` |
| Area list | `↓ ↑ Enter`, staged `Escape` in the search field, no `j k` | `handleAreaSearchKey`, `:2423-2452` |
| Focus picker | text field, `Escape` unwinds, checkboxes by `Tab` | `:2530-2540`, `work-desk-view.js:173-264` |
| Global | `⌘K` Go To, `⌘J` session, `⌘/` Find work | `shell.js:55-58` |

Two text-entry detectors exist (`textEntry` in `keyboardContext`, `isDocumentTextEntry` in the reader). Two Tab traps (chooser, Go To). Three `gg` timers. The navigation record already decides to collapse these (decision 5).

Collisions today: `n` note in Work versus `n` next comment in reader; `r` questions on an Area versus `r` resume on a Goal versus `r` reply in the reader; `h l` fold in Work versus `H L` history in the reader (different case, no collision); `?` help everywhere, so `?` cannot be backward search.

## 3. Precedent

**Internal.** The launch chooser is the one surface that already has the full grammar: `j k` and arrows in a column, `h l` and arrows across columns, `Enter`, `Escape`. The modal has `j k` and arrows. Both prove that letters and arrows as synonyms work when no text field is focused.

**External.**

- Vim normal mode: `j k h l`, `gg G`, `{ }`, `/ n N`, `Ctrl-D Ctrl-U`, `zz`. Julian's stated model.
- Vim insert-mode completion and fzf, Telescope, and the Neovim command line: `Ctrl-N` and `Ctrl-P` move a list while typing. This is the home-row way to move inside a text-owned list. Chrome on macOS leaves `Ctrl-N` and `Ctrl-P` unbound.
- Vim bracket motions: `]c [c`, `]s [s`. A `]x` chord means "next x". Used for reader comments.
- Magit and Vim's `which-key`: letters that act on the focused object are legal when the surface prints them. Already the ADR-0038 rule.

## 4. Lens analysis

### 4.1 UI/UX

**Intent.** Hands stay on the home row. The same motion works everywhere. The key sheet shows what works here.

**Workflow traced: find a Goal and enter its worker.** `⌘/` from anywhere, type part of the title, `Enter`, `⌘J`. From another Goal: `n`, `⌘J`. Through Areas: `}` to the Area, `l` to open it, `j` to the Goal, `Enter`. Every step is one key.

**Workflow traced: pick a harness.** `Enter` on a Goal with no live worker opens the chooser. `l` to the model column, `j` twice, `Enter`. No mouse, no Tab.

**Workflow traced: read and comment.** `o` on a Goal, `}` to the next heading, `]c` to the next comment, `r` reply. `Escape` clears the comment, then `Escape` leaves the reader.

**Visible state.** The search bar is the mode indicator for `n N`. The key sheet is the only other teaching surface, plus the caption line per row kind (registry `captionKeysByRow`). No new chrome.

**Departures from Vim, deliberate.** `h l` fold and unfold a tree, they do not move left and right; Vim users of file trees (nvim-tree, netrw) expect this. `Escape` in Work unwinds one constraint instead of doing nothing. `?` is help, not backward search. `{ }` move by section (Area header, heading), the Vim paragraph idea applied to the table.

**Accessibility.** Arrows stay as full synonyms of `j k` on every non-text surface, so a user who never learns Vim loses nothing. `Home End` are synonyms of `gg G`. Every key has `aria-keyshortcuts` from the registry. `Ctrl-N/P` are additions, never replacements for arrows.

### 4.2 Architecture and state

**One registry, two scopes.** `work-commands.js` grows a `surface` field (`work`, `reader`, `go-to`, `chooser`, `modal`, `list`, `all`). The reader's pure matcher stays pure but reads its key definitions from the same records instead of hardcoded `code` strings. The key sheet filters by the visible surface. This is the navigation record's per-object availability, applied to surfaces.

**One motion resolver.** `resolveMotion(event, { surface, textOwned, pendingChord })` in a new pure module returns a motion id (`next`, `previous`, `first`, `last`, `sectionNext`, `sectionPrevious`, `parent`, `child`, `halfDown`, `halfUp`, `search`, `matchNext`, `matchPrevious`, `enter`, `back`) or `null`. Each surface maps motion ids to its own movement. Work moves the cursor, the reader scrolls, Go To changes `selected`. This replaces `moveBetweenWorkRows`, the chooser's inline arrays, the modal's inline arrays, and the Area list arrows.

**One chord engine.** `pendingChord` with one 650 ms timer in shell state, keyed by surface. `gg`, `]c`, `[c` use it. The three timers go.

**One text-entry rule.** `textOwned` is computed once by `keyboardContext` and passed to the resolver. `isDocumentTextEntry` becomes the shared implementation.

**State touched.** No persisted state changes. `workPendingG`, `keySheetPendingG`, and the reader's `pendingG` collapse into `state.pendingChord`.

## 5. The keymap (Decision)

### 5.1 Motion, every surface where no text field has focus

| Key | Synonym | Motion | Work | Reader | Go To, modal, chooser, Area list |
|---|---|---|---|---|---|
| `j` | `↓` | next | next row | scroll one line | next item |
| `k` | `↑` | previous | previous row | scroll one line up | previous item |
| `gg` | `Home` | first | first row | top | first item |
| `G` | `End` | last | last row | bottom | last item |
| `}` | | next section | next Area header, top-level or sub-Area | next heading | not bound |
| `{` | | previous section | previous Area header | previous heading | not bound |
| `l` | `→` | child | expand, or move to first child | not bound | chooser: next column |
| `h` | `←` | parent | collapse, or move to parent | not bound | chooser: previous column |
| `Ctrl-D` | `PageDown` | half page down | cursor half a viewport of rows down | half page | not bound |
| `Ctrl-U` | `PageUp` | half page up | cursor half a viewport up | half page | not bound |
| `H` | | history back | not bound | previous Document | not bound |
| `L` | | history forward | not bound | next Document | not bound |

### 5.2 Search

| Key | Motion | Work | Reader | Text-owned list |
|---|---|---|---|---|
| `/` | search | open the search bar | reserved, see 8 | types |
| `n` | next match | next match, wrap | reserved | types |
| `N` | previous match | previous match, wrap | reserved | types |
| `]c` | next comment | not bound | next comment | not bound |
| `[c` | previous comment | not bound | previous comment | not bound |

### 5.3 Inside a text-owned list (Go To input, search bar, Focus picker, Area search)

| Key | Motion |
|---|---|
| `↓`, `Ctrl-N` | next item or match |
| `↑`, `Ctrl-P` | previous item or match |
| `Enter` | choose, or confirm the search |
| `Escape` | clear the text when present, else close the surface |
| `⌘K` | close Go To when it is open |

Letters always type. `j k h l g n N` never move here.

### 5.4 Enter and leave

| Key | Everywhere |
|---|---|
| `Enter` | go into the live thing, or the editor that makes it live (navigation record 3.3) |
| `Escape` | Back: remove one layer, or unwind the top Work constraint (transient, staged Focus, search, applied Focus, Work tab) |
| `⌘J` | enter or leave the live session of the current row; the only key the terminal gives back |
| `⌘K` | Go To |
| `⌘/` | Work, then `/` |
| `:` | commands for the current object |
| `?` | keys for the visible surface |

### 5.5 Removed

- `n` capture note in Work. Julian's word. Note stays in the `:` menu.
- `↓ ↑ Home End` as a DOM-focus-only row walk (`moveBetweenWorkRows`). They become synonyms of `j k gg G` through the cursor.
- The top filter field and the `filter` command. Decided in the search record and confirmed by Julian.
- `Tab` as row movement anywhere. Tab is native focus order only, trapped inside the chooser and Go To as today.
- `⌘⌥N`, `⌘⌥P` reader comment steps. `]c [c` replace them. `⌘⌥M` new comment stays until the reader's `c` is proven on every keyboard layout.

### 5.6 Action letters kept, for collision review only

Work: `b s d a f r o c x`. Reader: `c e r x`. Goal status modal: `d c w p r`. None collides with a motion in 5.1 to 5.4 on the same surface. `r` keeps its three object meanings (questions, resume, reply); each surface prints it. `f` Focus stays as Julian's filter.

## 6. Decisions

1. Vim motions of 5.1 are the one grammar. Arrows, `Home`, `End`, `PageUp`, `PageDown` are synonyms and are never removed.
2. Letters move only when no text field has focus. Inside a text-owned list, `Ctrl-N Ctrl-P` join the arrows. Reason: home-row movement while typing without stealing letters.
3. `n N` mean search match everywhere. The reader's comment motion moves to `]c [c`. Reason: one meaning per key, Vim's bracket motion idiom, and the reader will get `/` later.
4. `Ctrl-D Ctrl-U` come to Work. Reason: parity with the reader at near-zero cost; long tables exist.
5. One motion resolver, one chord engine, one text-entry rule. Reason: the navigation record's decision 5, made concrete.
6. The registry gains a `surface` field and the reader reads its keys from it. Reason: one source for keys, help, and `aria-keyshortcuts` on every surface.
7. `?` renders the sheet for the visible surface, grouped: motion, search, enter and leave, actions. Reason: teach only what works here.
8. `moveBetweenWorkRows` is deleted, with an anti-regrowth lint entry like `725e619`.

## 7. Rejected alternatives

- **Vim counts (`3j`, `5}`)**: a count engine plus a visible pending-count indicator for a table that rarely exceeds one screen. `/`, `{ }`, `Ctrl-D` cover the distance. Reconsider if assignment rows make tables long.
- **`Ctrl-J Ctrl-K` instead of `Ctrl-N Ctrl-P` in text lists**: `⌘J` already means session; a `Ctrl-J` next to it invites mistakes, and `Ctrl-J` is a newline in some fields.
- **Visual mode, operators, marks**: no multi-select exists in the product; nothing to operate on.
- **`?` as backward search**: `?` is help on every surface and in the reader. `N` covers it.
- **Keep `n` note and let search override it**: the earlier search draft. Julian removed the shortcut, which is simpler.
- **`Space` as a leader key (Neovim style)**: a second chord namespace next to `g` and `]`. Not needed while every action fits one letter on a surface that prints it.

## 8. Risks, assumptions, unknowns

- **Unknown:** reader search. `/ n N` are reserved in the reader and unbound until a reader search exists. Until then `]c [c` are the only reader jumps besides headings. If Julian wants reader search soon, it reuses the search bar and the resolver.
- **Assumption:** `Ctrl-N Ctrl-P` reach the page in Chrome on macOS. Observed in other apps, not yet tested in Agent Shell. Test first.
- **Risk:** `]c [c` are two-key chords in a surface that had one-key comment steps. The 650 ms chord window is proven for `gg`.
- **Risk:** `PageUp PageDown` as synonyms may fight native scroll in the reader. Bind them only where the surface owns the scroll container.
- **Reconsider when:** assignment rows land (navigation record 3.1); `h l` must walk that level too, with no new keys.

## 9. Sources

- `packages/agent-shell/app/public/work-commands.js`
- `packages/agent-shell/app/public/shell-event-bindings.js:393-467, 887-889, 1196-1217, 2120-2149, 2423-2452, 2459-2495, 2530-2540, 2569-2660`
- `packages/agent-shell/app/public/document-reading-commands.js:26-90`
- `packages/agent-shell/app/public/shell.js:55-58`
- `packages/agent-shell/app/public/keyboard-context.js`
- `docs/decisions/ADR-0038-*.md`
- `docs/design/agent-shell-navigation-model/design-record.md` (3.2, 3.3, decision 5, candidate B)
- `docs/design/agent-shell-work-search/design-record.md`
