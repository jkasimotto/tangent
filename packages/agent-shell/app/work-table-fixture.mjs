// The one seven-Goal, three-group Work fixture. The density proof compares the
// old cards and the new table on exactly these records
// (otto/tangent/design-redesign-work-as-a-compact-table, proof 9), and the DOM,
// keyboard, focus, and state proofs read the same rows.

const DAY = 86_400_000;
const MINUTE = 60_000;

/** Builds one open Goal record in the shape the vault projection sends. */
function goal(area, slug, title, extra = {}) {
  return {
    mtime: 1, area, slug, file: `${area}/goal-${slug}.md`, title, status: "open",
    doneWhen: `${title} is done.`, waitingOn: "", depth: 0, order: 1,
    dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [],
    ...extra,
  };
}

/** Builds one live Area brain with no open requests. */
function brain(area, generation, state) {
  return { area, status: "active", live: true, session: `${area.replaceAll("/", "-")}--brain`, generation, state, forJulian: [], requests: [] };
}

/**
 * The three brain-owned groups and their seven current Goals: one stopped
 * pipeline, four live agents, one step that waits, and one result that is
 * ready for validation.
 */
export function workTableFixture(now = Date.now()) {
  const walkthrough = goal("otto/onboarding", "walkthrough", "Redesign the onboarding walkthrough", { changedAt: now - 3 * DAY, firstStartAt: now - 211 * MINUTE });
  const docs = goal("otto/standards", "framework-docs", "Land standards framework docs", { changedAt: now - DAY, session: "standards--docs", firstStartAt: now - 12 * MINUTE });
  const nesc = goal("otto/standards", "nesc-241", "Extract NESC 241-250", { changedAt: now - DAY, session: "standards--nesc", firstStartAt: now - 9 * MINUTE });
  const inconsistencies = goal("otto/tangent", "inconsistencies", "Find architectural inconsistencies", { changedAt: now - 2 * DAY, session: "tangent--inconsistencies", firstStartAt: now - 153 * MINUTE });
  const table = goal("otto/tangent", "compact-table", "Redesign Work as a compact table", { changedAt: now - MINUTE, session: "tangent--table", firstStartAt: now - 8 * MINUTE });
  const voice = goal("otto/tangent", "voice-dump", "Route one voice dump across Areas", { changedAt: now - MINUTE, session: "tangent--voice", firstStartAt: now - 7 * MINUTE });
  const online = goal("otto/tangent", "stays-online", "Agent Shell stays online during use", { status: "ready", changedAt: now - 67 * MINUTE, firstStartAt: now - 67 * MINUTE, lastEndAt: now - MINUTE });
  const goals = [walkthrough, docs, nesc, inconsistencies, table, voice, online];
  // No `otto` root record: every Area has a row, so a root would make one
  // group with three sub-headers. These tests are about keys and rows, and
  // they read three peer groups. work-sub-area-headers-ui proves the root.
  const areas = [
    { path: "otto/onboarding", name: "onboarding", goals: [walkthrough], documents: [] },
    { path: "otto/standards", name: "standards", goals: [docs, nesc], documents: [] },
    { path: "otto/tangent", name: "tangent", goals: [inconsistencies, table, voice, online], documents: [] },
  ];
  const map = areas.filter((area) => area.goals.length).map((area) => ({ path: area.path, name: area.name, goals: area.goals }));
  const sessions = [
    { name: "standards--docs", goal: docs.file, state: "working", command: "claude", created: now - 12 * MINUTE },
    { name: "standards--nesc", goal: nesc.file, state: "working", command: "claude", created: now - 9 * MINUTE },
    { name: "tangent--inconsistencies", goal: inconsistencies.file, state: "waiting", stateDetail: "decision", command: "codex", created: now - 153 * MINUTE },
    { name: "tangent--table", goal: table.file, state: "working", command: "codex", created: now - 8 * MINUTE },
    { name: "tangent--voice", goal: voice.file, state: "working", command: "codex", created: now - 7 * MINUTE },
    { name: "otto-onboarding--brain", area: "otto/onboarding", kind: "brain", state: "waiting", command: "claude" },
    { name: "otto-standards--brain", area: "otto/standards", kind: "brain", state: "working", command: "claude" },
    { name: "otto-tangent--brain", area: "otto/tangent", kind: "brain", state: "working", command: "claude" },
  ];
  const brains = [brain("otto/onboarding", 1, "waiting"), brain("otto/standards", 3, "working"), brain("otto/tangent", 82, "working")];
  // The legacy plan line keeps the finished Goal in the Current view. The
  // density fixture carries no direct ask, as the measured live sample did not
  // (design-redesign-work-as-a-compact-table, "Live measurement").
  brains[2].forJulian = [{ line: "- Accept: Agent Shell stays online during use", kind: "test", file: online.file, goalStatus: "ready" }];
  const pipelines = [
    {
      goal: walkthrough.file, status: "running", updatedAt: now - 211 * MINUTE,
      steps: [
        { index: 1, status: "complete", label: "claude", instruction: "Design it.", state: "idle", live: false },
        { index: 2, status: "complete", label: "claude", instruction: "Build it.", state: "idle", live: false },
        { index: 3, status: "stopped", label: "codex", instruction: "Review it.", state: "shell", live: false, startedAt: now - 211 * MINUTE },
      ],
    },
    {
      goal: inconsistencies.file, status: "running", updatedAt: now - 153 * MINUTE,
      steps: [
        { index: 1, status: "running", label: "codex", instruction: "Find them.", session: "tangent--inconsistencies", state: "waiting", stateDetail: "decision", live: true, startedAt: now - 153 * MINUTE },
        { index: 2, status: "pending", label: "codex", instruction: "Write them up." },
      ],
    },
    {
      goal: table.file, status: "running", updatedAt: now - 8 * MINUTE,
      steps: [
        { index: 1, status: "running", label: "codex", instruction: "Build it.", session: "tangent--table", state: "working", live: true, startedAt: now - 8 * MINUTE },
        { index: 2, status: "pending", label: "codex", instruction: "Review it." },
      ],
    },
  ];
  return { now, goals, vault: { areas, map, documents: [] }, sessions, brains, pipelines };
}

/** Builds one open Test request that makes its Goal ready for validation. */
function testRequest(file) {
  return {
    id: "req-test", kind: "test", status: "open", goal: file, subjectRef: { type: "goal", goal: file },
    subject: "Agent Shell stays online during use", question: "Does this result meet the done condition?",
    proposal: "Accept the result.", detail: "Open the shell and reload it twice.", options: [],
  };
}

/** Adds the Test and Decide requests the direct-ask table shows. */
export function withDirectAsks(fixture) {
  const online = fixture.goals.find((item) => item.status === "ready");
  const brains = fixture.brains.map((item) => item.area !== "otto/tangent" ? item : {
    ...item,
    requests: [...item.requests, testRequest(online.file), {
      id: "req-decide", kind: "decision", status: "open", goal: null, subjectRef: { type: "brain", area: "otto/tangent", generation: 82 },
      subject: "Voltage source", question: "Which voltage source owns this value?", proposal: "Use the line record.", detail: "", options: [],
    }],
  });
  return { ...fixture, brains };
}

/**
 * Adds one Area whose brain is live and whose Goals are none. It is the case
 * Julian could not see: the brain thinks or waits, and no worker agent runs
 * (design-active-brains-show-on-work-even-with-no-agents). Pass `live: false`
 * for the same Area with a stopped brain. Pass `planned: true` for the more
 * common shape of the same case: the Area holds Goals, every one of them is
 * unstarted, so the Current filter keeps no row for it either.
 */
export function withBrainOnlyArea(fixture, { state = "working", stateDetail = "", live = true, planned = false } = {}) {
  const own = planned ? [goal("otto/quiet", "quiet-plan", "Plan the quiet Area")] : [];
  const areas = [...fixture.vault.areas, { path: "otto/quiet", name: "quiet", goals: own, documents: [] }];
  const map = own.length ? [...fixture.vault.map, { path: "otto/quiet", name: "quiet", goals: own }] : fixture.vault.map;
  const detail = stateDetail ? { stateDetail } : {};
  const record = live
    ? { ...brain("otto/quiet", 4, state), ...detail }
    : { ...brain("otto/quiet", 4, state), status: "inactive", live: false };
  const sessions = live
    ? [...fixture.sessions, { name: "otto-quiet--brain", area: "otto/quiet", kind: "brain", state, ...detail, command: "claude" }]
    : fixture.sessions;
  return {
    ...fixture,
    goals: [...fixture.goals, ...own],
    vault: { ...fixture.vault, areas, map },
    sessions,
    brains: [...fixture.brains, record],
  };
}

/**
 * The planned fixture: one Goal that can start, one that two prerequisites
 * block, one whose prerequisite will not be done, and one whose dependency
 * reference does not resolve. It proves the four readiness facts stay apart
 * from the lifecycle state.
 */
export function plannedWorkFixture(now = Date.now()) {
  const first = goal("otto/tangent", "first-prerequisite", "Write the storage contract", { changedAt: now - 5 * DAY });
  const second = goal("otto/tangent", "second-prerequisite", "Add the migration", { changedAt: now - 5 * DAY });
  const dropped = goal("otto/tangent", "dropped-prerequisite", "Ship the old importer", { status: "dropped", changedAt: now - 9 * DAY });
  const startable = goal("otto/tangent", "startable", "Name the sandbox that blocks a command", { changedAt: now - DAY });
  const blocked = goal("otto/tangent", "blocked", "Move every reader to the new store", {
    changedAt: now - DAY,
    dependsOn: [{ file: first.file, title: first.title, status: "open" }, { file: second.file, title: second.title, status: "open" }],
  });
  const broken = goal("otto/tangent", "broken", "Import the legacy archive", {
    changedAt: now - DAY,
    dependsOn: [{ file: dropped.file, title: dropped.title, status: "dropped" }],
  });
  const errored = goal("otto/tangent", "errored", "Reconcile the missing prerequisite", {
    changedAt: now - DAY,
    unresolvedDependencies: ["goal-that-was-deleted"],
  });
  const goals = [startable, blocked, broken, errored, first, second, dropped];
  const areas = [
    { path: "otto/tangent", name: "tangent", goals: [...goals], documents: [] },
  ];
  return {
    now, goals,
    vault: { areas, map: [{ path: "otto/tangent", name: "tangent", goals: [...goals] }], documents: [] },
    sessions: [{ name: "otto-tangent--brain", area: "otto/tangent", kind: "brain", state: "working", command: "claude" }],
    brains: [brain("otto/tangent", 82, "working")],
    pipelines: [],
  };
}
