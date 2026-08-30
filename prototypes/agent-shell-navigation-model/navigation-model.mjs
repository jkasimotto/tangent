/**
 * Pure navigation core for the unified Agent Shell navigation mockup.
 *
 * Why this exists: the design record (docs/design/agent-shell-navigation-model)
 * claims that one object tree, one cursor, one verb table, and one layer stack
 * can express every named intention. This module is that claim as data and
 * small functions, with no DOM, so the mockup page and the tests share it.
 */

/** Object kinds in tree order. Attempt rows are live sessions or history. */
export const KINDS = ["area", "brain", "goal", "assignment", "attempt", "document"];

/**
 * Verb availability matrix. Each cell is the label the verb carries on that
 * kind, or null when the verb does not apply (design record, section 3.3).
 */
export const VERBS = {
  enter: {
    key: "Enter",
    area: "Open the brain",
    brain: "Attach to the brain",
    goal: "Open the live worker, else the launch editor",
    assignment: "Open this step's live session, else its editor",
    attempt: "Attach terminal",
    document: "Open the reader",
  },
  read: {
    key: "o",
    area: "Read the Area note",
    brain: "Read the brain's note",
    goal: "Read the Goal",
    assignment: "Read the instruction",
    attempt: "Read the attempt context",
    document: "Read",
  },
  status: {
    key: "x",
    area: "Done or reopen",
    brain: "Stop or start",
    goal: "Done, won't do, park, reopen",
    assignment: "Skip or end",
    attempt: "Replace or retire",
    document: null,
  },
  menu: { key: ":", area: "All commands", brain: "All commands", goal: "All commands", assignment: "All commands", attempt: "All commands", document: "All commands" },
  child: {
    key: "a",
    area: "New Goal",
    brain: null,
    goal: "New Subgoal or step",
    assignment: "Insert step after",
    attempt: null,
    document: "New comment",
  },
};

/** Context-local letters that are legal only inside a surface that shows them. */
export const STATUS_CHOICES = {
  goal: [["d", "Done"], ["w", "Won't do"], ["p", "Park"], ["r", "Reopen"]],
  assignment: [["s", "Skip"], ["e", "End"]],
  attempt: [["r", "Replace with the same agent"], ["c", "Change the agent"], ["t", "Retire"]],
  area: [["d", "Done"], ["r", "Reopen"]],
  brain: [["s", "Stop"], ["r", "Restart"]],
};

/**
 * Sample vault. Shape mirrors the domain: Area > Brain / Goal (recursive) >
 * Assignment > Attempt, plus Documents. `session` is the tmux join key.
 */
export function sampleTree() {
  return [
    {
      id: "area:otto/tangent",
      kind: "area",
      title: "otto/tangent",
      children: [
        { id: "brain:otto/tangent", kind: "brain", title: "Brain", session: "tangent-brain-g327", children: [] },
        {
          id: "goal:otto/tangent/goal-navigation-model.md",
          kind: "goal",
          title: "Unified navigation model",
          status: "active",
          session: "tangent-worker-nav-2",
          children: [
            {
              id: "assignment:navigation-model#1",
              kind: "assignment",
              title: "1. Design record",
              status: "complete",
              children: [{ id: "attempt:navigation-model#1/1", kind: "attempt", title: "claude/opus, done", children: [] }],
            },
            {
              id: "assignment:navigation-model#2",
              kind: "assignment",
              title: "2. Prototype the model",
              status: "running",
              session: "tangent-worker-nav-2",
              children: [
                { id: "attempt:navigation-model#2/1", kind: "attempt", title: "codex/gpt-5, stopped", children: [] },
                { id: "attempt:navigation-model#2/2", kind: "attempt", title: "claude/fable, live", session: "tangent-worker-nav-2", children: [] },
              ],
            },
            { id: "assignment:navigation-model#3", kind: "assignment", title: "3. Review with Julian", status: "pending", children: [] },
          ],
        },
        {
          id: "goal:otto/tangent/goal-compact-work-refresh.md",
          kind: "goal",
          title: "Compact the Work refresh payload",
          status: "open",
          children: [],
        },
        { id: "document:otto/tangent/handover.md", kind: "document", title: "handover.md", children: [] },
      ],
    },
    {
      id: "area:neara/pgande",
      kind: "area",
      title: "neara/pgande",
      children: [
        { id: "brain:neara/pgande", kind: "brain", title: "Brain", children: [] },
        { id: "goal:neara/pgande/goal-autodesign.md", kind: "goal", title: "Autodesign poles", status: "open", children: [] },
      ],
    },
  ];
}

/** Flatten the tree to visible rows given the set of expanded ids. */
export function visibleRows(tree, expanded, depth = 0, parent = null) {
  const rows = [];
  for (const node of tree) {
    const hasChildren = node.children.length > 0;
    rows.push({ ...node, depth, parent, hasChildren, expanded: expanded.has(node.id) });
    if (hasChildren && expanded.has(node.id)) rows.push(...visibleRows(node.children, expanded, depth + 1, node.id));
  }
  return rows;
}

/** Initial state: one cursor, top-level Areas and Goals open, empty layer stack. */
export function initialState(tree = sampleTree()) {
  const expanded = new Set(tree.map((area) => area.id));
  for (const area of tree) for (const child of area.children) if (child.kind === "goal" && child.children.length) expanded.add(child.id);
  const rows = visibleRows(tree, expanded);
  return { tree, expanded, cursor: rows[0].id, layers: [], chord: null, log: [] };
}

/** Return the row under the cursor. */
export function cursorRow(state) {
  return visibleRows(state.tree, state.expanded).find((row) => row.id === state.cursor) ?? null;
}

/** Move the cursor by rows; the same function serves j/k, arrows, and clicks. */
export function moveCursor(state, delta) {
  const rows = visibleRows(state.tree, state.expanded);
  const index = Math.max(0, rows.findIndex((row) => row.id === state.cursor));
  const next = Math.min(rows.length - 1, Math.max(0, index + delta));
  return { ...state, cursor: rows[next].id };
}

/** Place the cursor on an id directly (pointer click, Go To, Back). */
export function setCursor(state, id) {
  return { ...state, cursor: id };
}

/** Jump to the first or last row (gg / G). */
export function jumpEdge(state, edge) {
  const rows = visibleRows(state.tree, state.expanded);
  return { ...state, cursor: rows[edge === "first" ? 0 : rows.length - 1].id };
}

/** Jump to the previous or next Area ({ / }). */
export function jumpArea(state, delta) {
  const rows = visibleRows(state.tree, state.expanded);
  const areas = rows.filter((row) => row.kind === "area");
  const current = rows.find((row) => row.id === state.cursor);
  const ownArea = areas.findIndex((area) => area.id === (current.kind === "area" ? current.id : rootArea(rows, current).id));
  const next = Math.min(areas.length - 1, Math.max(0, ownArea + delta));
  return { ...state, cursor: areas[next].id };
}

/** Walk parents up to the Area that owns a row. */
function rootArea(rows, row) {
  let node = row;
  while (node.parent) node = rows.find((candidate) => candidate.id === node.parent);
  return node;
}

/** h: collapse the row, or move to its parent when already collapsed. */
export function collapseOrParent(state) {
  const row = cursorRow(state);
  if (row.hasChildren && row.expanded) {
    const expanded = new Set(state.expanded);
    expanded.delete(row.id);
    return { ...state, expanded };
  }
  return row.parent ? { ...state, cursor: row.parent } : state;
}

/** l: expand the row, or move to its first child when already expanded. */
export function expandOrChild(state) {
  const row = cursorRow(state);
  if (!row.hasChildren) return state;
  if (!row.expanded) {
    const expanded = new Set(state.expanded);
    expanded.add(row.id);
    return { ...state, expanded };
  }
  const rows = visibleRows(state.tree, state.expanded);
  return { ...state, cursor: rows[rows.findIndex((candidate) => candidate.id === row.id) + 1].id };
}

/** Verbs available on a row, from the matrix; the key sheet and the : menu both read this. */
export function verbsFor(row) {
  return Object.entries(VERBS)
    .filter(([, verb]) => verb[row.kind])
    .map(([id, verb]) => ({ id, key: verb.key, label: verb[row.kind] }));
}

/** Resolve the live session for a row: the row's own, or its live descendant's. */
export function liveSession(row, tree) {
  if (row.session) return row.session;
  const node = findNode(tree, row.id);
  const stack = [...(node?.children ?? [])];
  while (stack.length) {
    const child = stack.shift();
    if (child.session) return child.session;
    stack.push(...child.children);
  }
  return null;
}

/** Find a node by id anywhere in the tree. */
export function findNode(tree, id) {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Push a layer. A layer records its opener's cursor so Back restores a
 * semantic object, never a DOM node (design record, section 3.4).
 */
export function pushLayer(state, layer) {
  return { ...state, layers: [...state.layers, { ...layer, returnCursor: state.cursor }] };
}

/** Back: pop the top layer and restore the opener's cursor. */
export function back(state) {
  if (!state.layers.length) return state;
  const top = state.layers[state.layers.length - 1];
  return { ...state, layers: state.layers.slice(0, -1), cursor: top.returnCursor };
}

/** Apply a verb to the row under the cursor. Returns the next state and a log line. */
export function applyVerb(state, verbId, choice = null) {
  const row = cursorRow(state);
  const verb = VERBS[verbId];
  if (!verb || !verb[row.kind]) return { state, log: `${verb?.key ?? verbId} does nothing on a ${row.kind}` };
  if (verbId === "enter") {
    const session = liveSession(row, state.tree);
    if (session) return { state: pushLayer(state, { kind: "session", title: session, session }), log: `Attached to tmux session ${session}` };
    if (row.kind === "document") return { state: pushLayer(state, { kind: "reader", title: row.title }), log: `Opened reader for ${row.title}` };
    return { state: pushLayer(state, { kind: "editor", title: `Launch editor: ${row.title}` }), log: `No live session; opened the launch editor for ${row.title}` };
  }
  if (verbId === "read") return { state: pushLayer(state, { kind: "reader", title: row.title }), log: `${verb[row.kind]}: ${row.title}` };
  if (verbId === "menu") return { state: pushLayer(state, { kind: "menu", title: `Commands: ${row.title}`, verbs: verbsFor(row) }), log: `Opened the command menu for ${row.title}` };
  if (verbId === "status") {
    if (!choice) return { state: pushLayer(state, { kind: "status", title: `${row.title}`, choices: STATUS_CHOICES[row.kind] ?? [] }), log: `Status choices for ${row.title}` };
    const label = (STATUS_CHOICES[row.kind] ?? []).find(([key]) => key === choice)?.[1];
    if (!label) return { state, log: `${choice} is not a status choice for a ${row.kind}` };
    return { state: back(state), log: `${label}: ${row.title}` };
  }
  if (verbId === "child") return { state: pushLayer(state, { kind: "editor", title: `${verb[row.kind]} under ${row.title}` }), log: `${verb[row.kind]} under ${row.title}` };
  return { state, log: "" };
}

/** Go To rows: every object in the tree, live sessions ranked first. */
export function goToRows(tree, query = "") {
  const rows = [];
  const walk = (nodes, path) => {
    for (const node of nodes) {
      rows.push({ id: node.id, kind: node.kind, title: node.title, path: [...path, node.title].join(" / "), session: node.session ?? null });
      walk(node.children, [...path, node.title]);
    }
  };
  walk(tree, []);
  const needle = query.trim().toLowerCase();
  return rows
    .filter((row) => !needle || row.path.toLowerCase().includes(needle) || (row.session ?? "").toLowerCase().includes(needle))
    .sort((a, b) => Number(Boolean(b.session)) - Number(Boolean(a.session)));
}

/** Expand every ancestor so a Go To target is visible before the cursor lands on it. */
export function revealPath(state, id) {
  const expanded = new Set(state.expanded);
  const walk = (nodes, trail) => {
    for (const node of nodes) {
      if (node.id === id) {
        for (const ancestor of trail) expanded.add(ancestor);
        return true;
      }
      if (walk(node.children, [...trail, node.id])) return true;
    }
    return false;
  };
  walk(state.tree, []);
  return { ...state, expanded, cursor: id };
}

/**
 * One key dispatcher for the list context. The page routes raw key events
 * here; layers own their keys first (modal > go-to > session > list).
 */
export function handleListKey(state, key) {
  if (state.chord === "g") {
    if (key === "g") return { state: jumpEdge({ ...state, chord: null }, "first"), log: "gg: first row" };
    state = { ...state, chord: null };
  }
  switch (key) {
    case "j":
    case "ArrowDown":
      return { state: moveCursor(state, 1), log: "" };
    case "k":
    case "ArrowUp":
      return { state: moveCursor(state, -1), log: "" };
    case "h":
    case "ArrowLeft":
      return { state: collapseOrParent(state), log: "" };
    case "l":
    case "ArrowRight":
      return { state: expandOrChild(state), log: "" };
    case "g":
      return { state: { ...state, chord: "g" }, log: "" };
    case "G":
      return { state: jumpEdge(state, "last"), log: "G: last row" };
    case "{":
      return { state: jumpArea(state, -1), log: "" };
    case "}":
      return { state: jumpArea(state, 1), log: "" };
    case "Enter":
      return applyVerb(state, "enter");
    case "o":
      return applyVerb(state, "read");
    case "x":
      return applyVerb(state, "status");
    case ":":
      return applyVerb(state, "menu");
    case "a":
      return applyVerb(state, "child");
    case "?":
      return { state: pushLayer(state, { kind: "keys", title: "Keys", verbs: verbsFor(cursorRow(state)) }), log: "" };
    default:
      return { state, log: "" };
  }
}
