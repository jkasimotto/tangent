/**
 * Pure core of the Area big picture mockup: a sample vault, brain panels in
 * the closed vocabulary, composition rules, and the key grammar. No DOM.
 * The page (index.html) renders whatever this module returns.
 */

export const SIGNAL_ORDER = ["needs you", "waiting on", "stuck", "moving", "quiet", "no brain"];

/** Sample Area tree. Children are listed in vault (tree) order. */
export const AREAS = {
  "neara": { name: "Neara", parent: null, children: ["neara/pgande", "neara/portland", "neara/delivery", "neara/essential", "neara/enums", "neara/hedno", "neara/onboarding"], brain: "live", noteAge: "3h", noteLines: 82, open: 2 },
  "neara/pgande": { name: "PG&E", parent: "neara", children: ["neara/pgande/megabranch", "neara/pgande/autodesign", "neara/pgande/standards", "neara/pgande/benchmarking"], brain: "none", noteAge: "6d", noteLines: 14, open: 0 },
  "neara/pgande/megabranch": { name: "Megabranch", parent: "neara/pgande", children: ["neara/pgande/megabranch/viz-input"], brain: "none", noteAge: "1d", noteLines: 40, open: 2 },
  "neara/pgande/megabranch/viz-input": { name: "viz-input", parent: "neara/pgande/megabranch", children: [], brain: "stopped", noteAge: "1d", noteLines: 120, open: 9 },
  "neara/pgande/autodesign": { name: "Autodesign", parent: "neara/pgande", children: [], brain: "none", noteAge: "4d", noteLines: 22, open: 5 },
  "neara/pgande/standards": { name: "Standards", parent: "neara/pgande", children: [], brain: "live", noteAge: "2h", noteLines: 55, open: 3 },
  "neara/pgande/benchmarking": { name: "Benchmarking", parent: "neara/pgande", children: [], brain: "none", noteAge: "9d", noteLines: 12, open: 1 },
  "neara/portland": { name: "Portland", parent: "neara", children: [], brain: "none", noteAge: "1d", noteLines: 70, open: 1 },
  "neara/delivery": { name: "Delivery", parent: "neara", children: ["neara/delivery/cli"], brain: "none", noteAge: "12d", noteLines: 8, open: 0 },
  "neara/delivery/cli": { name: "CLI", parent: "neara/delivery", children: [], brain: "none", noteAge: "12d", noteLines: 0, open: 1, checkIt: 1 },
  "neara/essential": { name: "Essential", parent: "neara", children: ["neara/essential/autodesign"], brain: "none", noteAge: "5d", noteLines: 10, open: 0 },
  "neara/essential/autodesign": { name: "Autodesign", parent: "neara/essential", children: [], brain: "live", noteAge: "6h", noteLines: 64, open: 2 },
  "neara/enums": { name: "Enums", parent: "neara", children: [], brain: "none", noteAge: "3d", noteLines: 30, open: 1 },
  "neara/hedno": { name: "Hedno", parent: "neara", children: [], brain: "none", noteAge: "40d", noteLines: 0, open: 0 },
  "neara/onboarding": { name: "Onboarding", parent: "neara", children: [], brain: "none", noteAge: "20d", noteLines: 6, open: 0 },
};

/**
 * Panels as brains declare them. The Neara brain reads every descendant note
 * and composes most of these itself (presentedBy: neara). Where a child has
 * its own brain, that brain presents its own panel and wins on its Area.
 */
export const PANELS = {
  "neara": {
    presentedBy: "tangent-brain-neara-g192", at: "12 min ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "neara-1", outcome: "Ship what PG&E is waiting on this week", signal: "needs you", next: "Your graphics check in the cdev tab, then the handoff", who: "Julian", by: null,
        evidence: [{ label: "plan-viz-input.md", kind: "doc" }, { label: "cdev tab", kind: "url" }],
        relations: [{ kind: "needs", target: "Every viz-input phab approved", area: "neara/pgande/megabranch/viz-input" }],
        unsure: "Whether Tom Wilson still takes the non-graphics phabs", source: "neara.md § Current" },
      { id: "neara-2", outcome: "Standards proof done before US Monday", signal: "needs you", next: "Smoke test in the tab on otto-nesc23", who: "Julian", by: { date: "2026-08-31", words: "before Monday US time" },
        evidence: [{ label: "PR #1636", kind: "url" }, { label: "wrapup-standards-transfer-run.md", kind: "doc" }],
        relations: [{ kind: "needs", target: "Neil's six decisions", area: "neara/portland" }],
        unsure: null, source: "brain" },
    ],
    options: [
      { id: "neara-o1", text: "Send Sami and Sahan the graphics package (after your check)" },
      { id: "neara-o2", text: "Start a brain on PG&E" },
    ],
  },
  "neara/pgande": {
    presentedBy: "tangent-brain-neara-g192", at: "12 min ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "pgande-1", outcome: "Land the megabranch", signal: "needs you", next: "Your graphics check in the cdev tab", who: "Julian", by: null,
        evidence: [{ label: "megabranch.md § Current", kind: "note" }],
        relations: [{ kind: "needs", target: "Every viz-input phab approved", area: "neara/pgande/megabranch/viz-input" }],
        unsure: null, source: "pgande.md § Current" },
      { id: "pgande-2", outcome: "PG&E approves the autodesign behaviour", signal: "waiting on", who: "Neil", next: "Ask Neil whether 'keep inbuilt behaviour' closes it", by: null,
        evidence: [{ label: "goal-autodesign-approval.md (done)", kind: "goal" }],
        relations: [], unsure: "Julian said 'no, keep the current inbuilt behaviour'. Is that the approval?", source: "brain" },
    ],
    options: [{ id: "pgande-o1", text: "Nudge Eric, Toby, Tom about their phabs" }],
  },
  "neara/pgande/megabranch": {
    presentedBy: "tangent-brain-neara-g192", at: "12 min ago", commit: "a1f3c9", changesSince: 2,
    outcomes: [
      { id: "mega-1", outcome: "Land the megabranch", signal: "needs you", next: "Your graphics check in the cdev tab", who: "Julian", by: null,
        evidence: [{ label: "design-megabranch-split.md (done)", kind: "doc" }, { label: "goal-organize-graphics-commits.md", kind: "goal" }],
        relations: [{ kind: "needs", target: "Every viz-input phab approved", area: "neara/pgande/megabranch/viz-input" }, { kind: "shares", target: "branch megabranch-2 with Standards", area: "neara/pgande/standards" }],
        unsure: null, source: "megabranch.md § Current" },
    ],
    options: [],
  },
  "neara/pgande/megabranch/viz-input": {
    presentedBy: "tangent-brain-viz-input-g6", at: "1d ago", commit: "77e0b2", changesSince: 4, brainStopped: true,
    outcomes: [
      { id: "viz-1", outcome: "Every viz-input phab approved", signal: "needs you", next: "Open the cdev tab and run the checklist", who: "Julian", by: null,
        evidence: [{ label: "goal-graphics-checklist.md", kind: "goal" }, { label: "cdev tab", kind: "url" }, { label: "plan-viz-input.md", kind: "doc" }],
        relations: [{ kind: "feeds", target: "Land the megabranch", area: "neara/pgande/megabranch" }],
        unsure: null, source: "viz-input.md § Current" },
      { id: "viz-2", outcome: "Reviewers hold their phabs", signal: "waiting on", who: "Eric, Toby, Tom", next: "Nudge Eric (ui), Toby (ui/ux), Tom (rest)", by: null,
        evidence: [{ label: "viz-input.md § Reviewers", kind: "note" }], relations: [], unsure: null, source: "viz-input.md § Reviewers" },
    ],
    options: [
      { id: "viz-o1", text: "Send Sami and Sahan the package (after your check)" },
      { id: "viz-o2", text: "Nudge Eric, Toby, Tom" },
    ],
  },
  "neara/pgande/autodesign": {
    presentedBy: "tangent-brain-neara-g192", at: "12 min ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "pa-1", outcome: "Define what a pole diff is", signal: "stuck", next: "Decide: built-structure diff or design-key diff", who: "Julian", by: null,
        evidence: [{ label: "goal-pole-diff.md", kind: "goal" }],
        relations: [{ kind: "same as", target: "structure diff", area: "neara/essential/autodesign" }],
        unsure: "Julian can mean the built structure diff", source: "autodesign.md § Voice dump 2026-08-20" },
      { id: "pa-2", outcome: "Angle poles default to 13m", signal: "quiet", next: "Warn designers instead of changing the default", who: "Julian", by: null,
        evidence: [{ label: "goal-angle-poles-13m.md", kind: "goal" }], relations: [], unsure: null, source: "autodesign.md § Voice dump 2026-08-20" },
    ],
    options: [{ id: "pa-o1", text: "Fold the five voice-dump Goals into these two outcomes" }],
  },
  "neara/pgande/standards": {
    presentedBy: "tangent-brain-standards-g14", at: "20 min ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "std-1", outcome: "Library item properties discoverable", signal: "moving", next: "Worker finishes the property index", who: "worker", by: null,
        evidence: [{ label: "goal-library-item-properties.md", kind: "goal" }, { label: "D100212", kind: "phab" }],
        relations: [{ kind: "shares", target: "branch megabranch-2 with Megabranch", area: "neara/pgande/megabranch" }], unsure: null, source: "standards.md § Current" },
    ],
    options: [],
    parentSays: { signal: "waiting on", who: "Neil" },
  },
  "neara/pgande/benchmarking": null,
  "neara/portland": {
    presentedBy: "tangent-brain-neara-g192", at: "12 min ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "por-1", outcome: "Finish the standards transfer on otto-nesc23", signal: "needs you", next: "Smoke test in the tab", who: "Julian", by: { date: "2026-08-31", words: "before Monday US time" },
        evidence: [{ label: "PR #1636", kind: "url" }, { label: "1065 tests green", kind: "test" }, { label: "15 unpushed commits", kind: "commit" }],
        relations: [{ kind: "feeds", target: "Standards proof done before US Monday", area: "neara" }],
        unsure: null, source: "brain" },
      { id: "por-2", outcome: "Get Neil's six decisions", signal: "waiting on", who: "Neil", next: "Copy the six questions to Neil", by: null,
        evidence: [{ label: "wrapup-standards-transfer-run.md", kind: "doc" }], relations: [], unsure: "Two of the six may already be settled in the phab thread", source: "portland.md § Current" },
    ],
    options: [{ id: "por-o1", text: "Set the Monday deadline on the Goal" }],
  },
  "neara/delivery": null,
  "neara/delivery/cli": null,
  "neara/essential": null,
  "neara/essential/autodesign": {
    presentedBy: "tangent-brain-essential-autodesign-g3", at: "6h ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "ea-1", outcome: "Julian reads the structure diff design", signal: "needs you", next: "Read the revised design", who: "Julian", by: null,
        evidence: [{ label: "design-structure-diff-replaces-autodesign-keys.md", kind: "doc" }],
        relations: [{ kind: "same as", target: "pole diff", area: "neara/pgande/autodesign" }],
        unsure: "Guy-wire matching was never retested after the fixes", source: "autodesign.md § Current" },
    ],
    options: [{ id: "ea-o1", text: "Drop the older present Goal, it is a duplicate" }],
  },
  "neara/enums": {
    presentedBy: "tangent-brain-neara-g192", at: "12 min ago", commit: "a1f3c9", changesSince: 0,
    outcomes: [
      { id: "en-1", outcome: "Enum UI location decided", signal: "needs you", next: "Pick: settings page or inline editor", who: "Julian", by: null,
        evidence: [{ label: "enums.md § Open question", kind: "note" }], relations: [], unsure: null, source: "brain" },
    ],
    options: [],
  },
  "neara/hedno": null,
  "neara/onboarding": null,
};

/** Mechanical facts Tangent owns, per Area, never merged into the brain's outcomes. */
export const TANGENT = {
  "neara": { agents: 1, checkIt: 1, requests: 0, brainsLive: 3, brainsTotal: 15 },
  "neara/pgande": { agents: 1, checkIt: 0, requests: 0, brainsLive: 1, brainsTotal: 5 },
  "neara/pgande/megabranch": { agents: 0, checkIt: 0, requests: 1, brainsLive: 0, brainsTotal: 2 },
  "neara/pgande/megabranch/viz-input": { agents: 0, checkIt: 0, requests: 1, brainsLive: 0, brainsTotal: 1 },
  "neara/pgande/standards": { agents: 1, checkIt: 0, requests: 0, brainsLive: 1, brainsTotal: 1 },
  "neara/delivery": { agents: 0, checkIt: 1, requests: 0, brainsLive: 0, brainsTotal: 2, checkItRows: [{ title: "Lint reserved field names", phab: "D100199", age: "1d", area: "neara/delivery/cli" }] },
  "neara/delivery/cli": { agents: 0, checkIt: 1, requests: 0, brainsLive: 0, brainsTotal: 1, checkItRows: [{ title: "Lint reserved field names", phab: "D100199", age: "1d", area: "neara/delivery/cli" }] },
};

/** Tangent facts for an Area, with zeros when nothing is recorded. */
export function tangentSees(areaId) {
  return TANGENT[areaId] ?? { agents: 0, checkIt: 0, requests: 0, brainsLive: 0, brainsTotal: 1 };
}

/** Rank of a signal for child-row sorting (rule 8). */
function signalRank(signal) {
  const index = SIGNAL_ORDER.indexOf(signal);
  return index === -1 ? SIGNAL_ORDER.length : index;
}

/**
 * The top line of a child row. A Check it Goal is a Tangent fact and shows
 * even when no brain presented a panel (section 10.1).
 */
export function childTopLine(areaId) {
  const area = AREAS[areaId];
  const panel = PANELS[areaId];
  const facts = tangentSees(areaId);
  if (panel && panel.outcomes.length) {
    const head = panel.outcomes[0];
    return { areaId, name: area.name, signal: head.signal, who: head.who, next: head.next, by: head.by, source: head.source, parentSays: panel.parentSays ?? null, fallback: false, brainStopped: Boolean(panel.brainStopped) };
  }
  if (facts.checkIt && facts.checkItRows) {
    const row = facts.checkItRows[0];
    return { areaId, name: area.name, signal: "needs you", who: "Julian", next: `Check it: ${row.title} · ${row.phab} · ${row.age}`, by: null, source: "tangent", parentSays: null, fallback: true, brainStopped: false };
  }
  const strongest = area.children.map(childTopLine).filter((line) => line.signal !== "no brain").sort((a, b) => signalRank(a.signal) - signalRank(b.signal))[0];
  if (strongest) return { ...strongest, name: `${area.name} / ${strongest.name}`, passedThrough: true };
  const empty = area.noteLines === 0 && area.open === 0 && area.children.length === 0;
  return { areaId, name: area.name, signal: "no brain", who: null, next: empty ? "nothing here" : `Current ${area.noteAge} · ${area.open} open` + (area.children.length ? ` · ${area.children.length} children` : ""), by: null, source: "tangent", parentSays: null, fallback: true, brainStopped: false };
}

/** Child rows of an Area, sorted by signal then tree order (rule 8). */
export function childRows(areaId) {
  return AREAS[areaId].children
    .map((child, order) => ({ ...childTopLine(child), order }))
    .sort((a, b) => signalRank(a.signal) - signalRank(b.signal) || a.order - b.order);
}

/** Cursor-addressable rows of one picture, in reading order. */
export function pictureRows(areaId) {
  const panel = PANELS[areaId];
  const rows = [];
  if (panel) {
    for (const outcome of panel.outcomes) rows.push({ kind: "outcome", id: `outcome:${outcome.id}`, areaId, outcome });
    for (const option of panel.options) rows.push({ kind: "option", id: `option:${option.id}`, areaId, option });
  }
  for (const child of childRows(areaId)) rows.push({ kind: "child", id: `child:${child.areaId}`, areaId: child.areaId, child });
  return rows;
}

/** Breadcrumb from the root to an Area. */
export function trail(areaId) {
  const path = [];
  for (let id = areaId; id; id = AREAS[id].parent) path.unshift({ id, name: AREAS[id].name });
  return path;
}

/** Every declared relation in an Area's subtree, as nodes and edges for the relations view. */
export function relationGraph(rootId) {
  const nodes = [];
  const edges = [];
  /** Collects the outcomes of an Area and its descendants. */
  const walk = (id) => {
    const panel = PANELS[id];
    if (panel) for (const o of panel.outcomes) nodes.push({ id: o.id, areaId: id, area: AREAS[id].name, outcome: o.outcome, signal: o.signal });
    AREAS[id].children.forEach(walk);
  };
  walk(rootId);
  for (const node of nodes) {
    const outcome = PANELS[node.areaId].outcomes.find((o) => o.id === node.id);
    for (const rel of outcome.relations) {
      const target = nodes.find((n) => n.areaId === rel.area && n.outcome === rel.target) ?? nodes.find((n) => n.areaId === rel.area);
      edges.push({ from: node.id, to: target?.id ?? null, kind: rel.kind, label: rel.target, area: rel.area });
    }
  }
  return { nodes, edges };
}

/** Initial UI state: a stack of pictures, one cursor per picture, pending brain messages. */
export function initialState(areaId = "neara") {
  return { stack: [{ areaId, cursor: 0, expanded: new Set() }], view: "list", layer: null, pending: {}, log: [] };
}

/** The picture on top of the stack. */
export function top(state) {
  return state.stack.at(-1);
}

/** The row under the cursor. */
export function cursorRow(state) {
  const picture = top(state);
  return pictureRows(picture.areaId)[picture.cursor] ?? null;
}

/** Replace the top picture with a changed copy. */
function withTop(state, change) {
  const stack = state.stack.slice();
  stack[stack.length - 1] = { ...top(state), ...change };
  return { ...state, stack };
}

/** Log a line so the page can show what the picture sent or opened. */
function log(state, line) {
  return { ...state, log: [...state.log, line] };
}

/** The Area responsible for a row: its own Area, where the responsible brain lives. */
function responsibleBrain(row) {
  const areaId = row.kind === "child" ? row.areaId : row.areaId;
  let id = areaId;
  while (id && !(PANELS[id] && !PANELS[id].brainStopped && AREAS[id].brain === "live")) id = AREAS[id].parent;
  return { areaId, brainArea: id ?? "neara", session: PANELS[id ?? "neara"]?.presentedBy ?? "tangent-brain-neara-g192" };
}

/** Words that name a row, used by the ask, correct and brain verbs. */
export function rowWords(row) {
  if (row.kind === "outcome") return row.outcome.outcome;
  if (row.kind === "option") return row.option.text;
  return `${row.child.name}: ${row.child.next}`;
}

/** Verbs available on a row, each with its printed key. Every verb has a visible control. */
export function verbsFor(row) {
  if (!row) return [];
  const common = [["a", "Ask"], ["c", "Correct"], [":", "Actions"], ["b", "Brain"], ["g", "Relations"], ["o", "Note"]];
  if (row.kind === "outcome") return [["Enter", "Expand"], ...common];
  if (row.kind === "option") return [["Enter", "Approve"], ...common];
  if (row.child.fallback && row.child.signal === "no brain") return [["Enter", "Open"], ["s", "Start brain"], ["o", "Note"]];
  return [["Enter", "Open"], ...common];
}

/** The `:` action menu for a row (section 8: open, copy, message a brain, enter a brain). */
export function actionsFor(row) {
  if (!row) return [];
  if (row.kind === "option") return [["approve", `Approve: ${row.option.text}`], ["message", "Message the brain"], ["enter", "Enter the brain"], ["copy", "Copy text"]];
  if (row.kind === "outcome") {
    const o = row.outcome;
    const first = o.who === "Julian" ? ["do", `Do it: ${o.next}`] : ["nudge", `Message the brain: nudge ${o.who}`];
    return [first, ["source", `Open source: ${o.source === "brain" ? "not in a note yet" : o.source}`], ["message", "Message the brain"], ["enter", "Enter the brain"], ["copy", "Copy outcome"]];
  }
  const c = row.child;
  if (c.signal === "no brain") return [["start", `Start brain on ${c.name}`], ["open", `Open ${c.name}`], ["note", "Open the note"]];
  return [["open", `Open ${c.name}`], ["message", `Message the ${c.name} brain`], ["enter", "Enter the brain"], ["note", "Open the note"]];
}

/** Handle one key on the list. Returns the next state; layers and views are part of state. */
export function handleKey(state, key) {
  if (state.layer) return handleLayerKey(state, key);
  if (state.view === "relations") {
    if (key === "Escape" || key === "g") return { ...state, view: "list" };
    return state;
  }
  if (key === "?") return { ...state, layer: { kind: "help" } };
  const picture = top(state);
  const rows = pictureRows(picture.areaId);
  const row = rows[picture.cursor] ?? null;
  switch (key) {
    case "j": case "ArrowDown": return withTop(state, { cursor: Math.min(rows.length - 1, picture.cursor + 1) });
    case "k": case "ArrowUp": return withTop(state, { cursor: Math.max(0, picture.cursor - 1) });
    case "g": return { ...state, view: "relations" };
    case "Escape": return back(state);
    case "o": return log(state, `open note ${row?.areaId ?? picture.areaId}.md`);
    case "Enter": return enter(state, row);
    case "a": return row ? { ...state, layer: { kind: "compose", mode: "ask", row, text: `About "${rowWords(row)}": ` } } : state;
    case "c": return row && row.kind !== "child" || (row && !row.child.fallback) ? { ...state, layer: { kind: "compose", mode: "correct", row, text: `Correction on "${rowWords(row)}": ` } } : state;
    case ":": return row ? { ...state, layer: { kind: "actions", row, choice: 0 } } : state;
    case "b": return row ? log(state, `enter ${responsibleBrain(row).session} with "${rowWords(row)}" quoted`) : state;
    case "s": return row?.kind === "child" && row.child.signal === "no brain" ? startBrain(state, row) : state;
    default: return state;
  }
}

/** Enter: expand an outcome, approve an option, drill into a child. */
function enter(state, row) {
  if (!row) return state;
  if (row.kind === "outcome") {
    const expanded = new Set(top(state).expanded);
    expanded.has(row.id) ? expanded.delete(row.id) : expanded.add(row.id);
    return withTop(state, { expanded });
  }
  if (row.kind === "option") return approve(state, row);
  return drill(state, row.areaId);
}

/** Open a child picture one level down; the parent keeps its cursor. */
export function drill(state, areaId) {
  return { ...state, view: "list", stack: [...state.stack, { areaId, cursor: 0, expanded: new Set() }] };
}

/** Jump to any Area's picture by id (Go To). */
export function goTo(state, areaId) {
  return { ...state, view: "list", layer: null, stack: [{ areaId, cursor: 0, expanded: new Set() }] };
}

/** Escape: pop the top picture and land on the parent with the cursor unchanged. */
export function back(state) {
  if (state.layer) return { ...state, layer: null };
  if (state.view === "relations") return { ...state, view: "list" };
  if (state.stack.length === 1) return log(state, "back to Work, cursor on the Area");
  return { ...state, stack: state.stack.slice(0, -1) };
}

/** Approve an option: one press is Julian's word; the brain starts without a second confirmation. */
export function approve(state, row) {
  const brain = responsibleBrain(row);
  const next = log(state, `send ${brain.session}: "Julian approved: ${row.option.text}"`);
  return { ...next, pending: { ...state.pending, [row.id]: "approved · waiting for the brain" }, layer: null };
}

/** Start a brain on a child Area that has none. */
function startBrain(state, row) {
  return { ...log(state, `tangent brain start ${row.areaId}`), pending: { ...state.pending, [row.id]: "brain starting" } };
}

/** Send the composed ask or correction to the responsible brain and mark the element. */
export function sendComposer(state) {
  const { mode, row, text } = state.layer;
  const brain = responsibleBrain(row);
  const marked = mode === "correct" ? { ...state.pending, [row.id]: "correction sent · waiting for the brain" } : { ...state.pending, [row.id]: "asked · waiting for the brain" };
  return { ...log(state, `send ${brain.session}${mode === "correct" ? " (correction)" : ""}: "${text}"`), pending: marked, layer: null };
}

/** Run one `:` action on the row of the actions layer. */
export function runAction(state, actionId) {
  const row = state.layer.row;
  const closed = { ...state, layer: null };
  const brain = responsibleBrain(row);
  switch (actionId) {
    case "approve": return approve(closed, row);
    case "do": return log(closed, `open ${row.outcome.evidence.find((e) => e.kind === "url")?.label ?? row.outcome.next}`);
    case "nudge": return log(closed, `send ${brain.session}: "Nudge ${row.outcome.who} about \"${row.outcome.outcome}\""`);
    case "source": return log(closed, row.outcome.source === "brain" ? `ask ${brain.session} to write it into the note` : `open ${row.outcome.source}`);
    case "message": return { ...closed, layer: { kind: "compose", mode: "ask", row, text: "" } };
    case "enter": return log(closed, `enter ${brain.session}`);
    case "copy": return log(closed, `copy "${rowWords(row)}"`);
    case "open": return drill(closed, row.areaId);
    case "note": return log(closed, `open note ${row.areaId}.md`);
    case "start": return startBrain(closed, row);
    default: return closed;
  }
}

/** Keys inside a layer (actions menu, composer, help). */
function handleLayerKey(state, key) {
  const layer = state.layer;
  if (key === "Escape") return { ...state, layer: null };
  if (layer.kind === "actions") {
    const actions = actionsFor(layer.row);
    if (key === "j" || key === "ArrowDown") return { ...state, layer: { ...layer, choice: Math.min(actions.length - 1, layer.choice + 1) } };
    if (key === "k" || key === "ArrowUp") return { ...state, layer: { ...layer, choice: Math.max(0, layer.choice - 1) } };
    if (key === "Enter") return runAction(state, actions[layer.choice][0]);
    return state;
  }
  if (layer.kind === "compose") {
    if (key === "Enter") return sendComposer(state);
    if (key === "Backspace") return { ...state, layer: { ...layer, text: layer.text.slice(0, -1) } };
    if (key.length === 1) return { ...state, layer: { ...layer, text: layer.text + key } };
    return state;
  }
  return state;
}

/** The key sheet, printed from the same verbs the rows show. */
export const KEY_SHEET = [
  ["j / k", "move the cursor"], ["Enter", "expand an outcome, approve an option, open a child"], ["a", "ask the brain about this element"],
  ["c", "correct this element (the brain changes the note, then presents again)"], [":", "actions: do it, open source, message, enter brain, copy"],
  ["b", "enter the responsible brain with this element quoted"], ["g", "relations view"], ["o", "open the Area note"], ["s", "start a brain on a child without one"],
  ["Esc", "back: parent picture, or Work"], ["?", "this sheet"],
];
