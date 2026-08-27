import { readAreaFocus } from "./area-focus-core.js";
import { readDismissedAskIds } from "./ask-dismissal-core.js";

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
  const storedAreaFocus = readAreaFocus(storage);
  const state = {
    vault: null,
    programs: { operations: [], problems: [], areas: [], liveCount: 0 },
    sessions: [], contextHandoverTokens: 0,
    currentFile: storage.getItem("agent-shell.current-goal") || "", view: initialView,
    document: null, goalDetail: null, documentReturn: null, documentTrail: [], documentTrailIndex: -1, documentPositions: new Map(), documentPendingG: "",
    documentPeek: null,
    commentComposer: null, commentCursor: -1,
    describeReturn: null, describeDraft: storedDescribeDraft?.session ? null : storedDescribeDraft, describeSessionName: savedDescribeSession,
    areaSelection: requestedArea || storage.getItem("agent-shell.last-area") || "", createArea: "", createReturnView: "work",
    expandedAreas: new Set(storedJson("agent-shell.expanded-areas") || []),
    foldedWorkAreas: new Set(storedJson("agent-shell.folded-work-areas") || []),
    collapsedDeskSections: new Set(storedJson("agent-shell.collapsed-desk-sections") || []),
    collapsedGoalTrees: new Set(storedJson("agent-shell.collapsed-goal-trees") || []),
    areaFocus: storedAreaFocus.areas, areaFocusPicker: null, areaFocusStorageError: storedAreaFocus.error,
    mapStates: new Map(), mapSelectFile: "", showDoneAreas: storage.getItem("agent-shell.show-done-areas") === "1", areaEdit: null,
    areaQuery: "", areaDocumentQuery: "", areaDocumentPeriod: "any", areaDocumentOrder: "newest", areaDocumentOnly: "", areaDocumentExcluded: new Set(),
    areaWorkQuery: "", areaWorkScope: "", areaWorkState: "all", areaWorkLimits: new Map(), areaHistory: false, areaJournal: null,
    programId: "", programDraft: { type: "process", area: "", name: "", command: "", cwd: "" },
    launch: { area: "", kind: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", assignmentKind: "implementation", assignmentPath: "", continueFrom: null, steps: [], active: 0, record: null, stale: null, replacement: null },
    defaultAgents: { area: "", editing: "", mode: "" },
    pipelines: [], brains: [], brainDraft: null, agentSessionName: null, sessionPeek: null,
    verdictLines: new Set(), dismissedAskIds: readDismissedAskIds(storage), goTo: null, launchTarget: "", launchAnchor: null, whatHappened: null,
    // Work is one durable projection. Ignore the retired Current/Planned
    // browser choice so an old local-storage value cannot hide Goals.
    harnessDraft: null, harnessReturnView: "work", query: "", workFilter: "all",
    workCursor: storage.getItem("agent-shell.work-cursor") || "",
    caffeinate: false, decisionReturnView: "agent", agentReturnView: "work", agentReturn: null, rebuilding: false, rebuild: null, goalCleanups: [],
    connection: {
      phase: "online", gatewayBoot: "", controllerBoot: "", lastSuccessAt: 0, lastFailureAt: null,
      retryAttempt: 0, nextRetryAt: null, eventStream: "unavailable", lastError: null,
    },
    updateAvailable: false, pendingCommits: [], deployedCommit: "", currentCommit: "", loading: true, error: "", renderedKey: "",
    promptInspector: { loading: false, title: "", text: "", error: "", file: "", area: "" },
    bestiarySelection: { mode: "model", concept: "area", lifecycle: "plan", transition: "work" },
  };
  return { requestedArea, requestedDocument, state };
}
