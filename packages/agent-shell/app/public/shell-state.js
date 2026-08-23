/** Creates Agent Shell's restored browser state and request context. */
export function createShellState(storage = globalThis.localStorage, href = globalThis.location.href) {
  /** Reads one optional JSON value from local storage. */
  function storedJson(key) {
    try { return JSON.parse(storage.getItem(key) || "null"); }
    catch { return null; }
  }

  const requestedLocation = new URL(href).searchParams;
  const requestedView = requestedLocation.get("view");
  const requestedArea = requestedLocation.get("area") || "";
  const requestedDocument = requestedLocation.get("document") || "";
  const initialView = requestedDocument ? "document" : requestedView === "prompts" ? "prompts" : ["areas", "programs"].includes(requestedView) ? "areas" : "work";
  const storedDescribeDraft = storedJson("agent-shell.describe-draft");
  const savedDescribeSession = storage.getItem("agent-shell.describe-session") || storedDescribeDraft?.session || "";
  const state = {
    vault: null,
    programs: { programs: [], errors: [], areas: [], liveCount: 0, timezone: "", scheduler: { installed: false, intervalMinutes: 30 } },
    sessions: [], contextHandoverTokens: 0,
    currentFile: storage.getItem("agent-shell.current-goal") || "", view: initialView,
    document: null, documentReturn: null, documentTrail: [], documentTrailIndex: -1, documentPositions: new Map(),
    commentComposer: null, commentCursor: -1,
    describeReturn: null, describeDraft: storedDescribeDraft?.session ? null : storedDescribeDraft, describeSessionName: savedDescribeSession,
    areaSelection: requestedArea || storage.getItem("agent-shell.last-area") || "", createArea: "", createReturnView: "work",
    expandedAreas: new Set(storedJson("agent-shell.expanded-areas") || []),
    collapsedDeskSections: new Set(storedJson("agent-shell.collapsed-desk-sections") || []),
    mapStates: new Map(), mapSelectFile: "", showDoneAreas: storage.getItem("agent-shell.show-done-areas") === "1", areaEdit: null,
    programId: "", programDraft: { type: "process", area: "", name: "", command: "", time: "07:30", cwd: "", model: "sonnet", prompt: "" },
    launch: { area: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", continueFrom: null, steps: [], active: 0, record: null },
    pipelines: [], brains: [], brainDraft: null, agentSessionName: null,
    verdictLines: new Set(), goalSelection: [], goTo: null, launchTarget: "", launchAnchor: null, whatHappened: null,
    harnessDraft: null, harnessReturnView: "work", query: "", workFilter: storage.getItem("agent-shell.work-filter") || "all",
    caffeinate: false, decisionReturnView: "agent", agentReturnView: "work", offline: false, rebuilding: false,
    updateAvailable: false, pendingCommits: [], deployedCommit: "", currentCommit: "", bootId: "", loading: true, error: "", renderedKey: "",
    promptInspector: { loading: false, title: "", text: "", error: "", file: "", area: "" },
    bestiarySelection: { lifecycle: "plan", transition: "work" },
  };
  return { requestedArea, requestedDocument, state };
}
