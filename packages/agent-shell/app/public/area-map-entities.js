import { isSafeResourceId } from "./area-map-wire-values.js";

// isSafeResourceId lives in the wire registry beside the resource ID minter.
// It is re-exported here so existing importers keep working.
export { isSafeResourceId };

const MAP_ENTITY_KINDS = new Set(["goal", "document", "area", "link", "brain", "agent", "person", "request", "commit", "evidence", "resource"]);
const VAULT_COMMIT_REF = /^vault@([0-9a-f]{7,40})$/;
const VERB_LABELS = Object.freeze({
  "copy-path": "Copy path", open: "Open", "open-document": "Open Document",
  "open-goal": "Open Goal", "open-brain": "Open Brain", details: "Details",
});
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** Joins the complete runtime identity of one Area resource without path ambiguity. */
export function resourceLocatorKey(locator) {
  return locator && typeof locator.owner === "string" && isSafeResourceId(locator.id)
    ? `${locator.owner}\u0000${locator.id}`
    : null;
}

/** Returns one semantic reference without accepting cached Block text as authority. */
function tangentOf(element) {
  const tangent = element?.customData?.tangent;
  return tangent && MAP_ENTITY_KINDS.has(tangent.kind) && typeof tangent.ref === "string" ? tangent : null;
}

/** Returns one source identity from an explicit value or a composed element. */
function sourceOf(input, element) {
  const candidate = input?.source ?? element?.customData?.tangentWorld ?? {};
  const owner = String(candidate.owner ?? input?.owner ?? "");
  const sourceId = String(candidate.sourceId ?? input?.sourceId ?? element?.id ?? "");
  return owner && sourceId ? { owner, sourceId } : null;
}

/** Returns selected IDs from the Set, array, or Excalidraw object representation. */
function selectedIds(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).filter(([, selected]) => Boolean(selected)).map(([id]) => id);
  return [];
}

/** Reports whether one Tangent element is a semantic Block rather than world structure. */
export function isMapEntityBlock(element) {
  const tangent = !element?.isDeleted && tangentOf(element);
  return Boolean(tangent && !["boundary", "region", "area-region", "endpoint-dot"].includes(tangent.role));
}

/**
 * Returns a semantic Block only when it is the one total live Map selection.
 * A Block plus ink, its label, or any other selected element is not semantic
 * action authority.
 */
export function selectedMapEntityElement(elements = [], selectedElementIds = []) {
  const byId = new Map((elements ?? []).filter((element) => !element?.isDeleted).map((element) => [element.id, element]));
  const selected = [...new Set(selectedIds(selectedElementIds))].map((id) => byId.get(id)).filter(Boolean);
  return selected.length === 1 && isMapEntityBlock(selected[0]) ? selected[0] : null;
}

/** Alias whose name describes the exact selection invariant at call sites. */
export const exactlyOneSelectedMapEntity = selectedMapEntityElement;

/** Returns a valid resource locator only when source owner and persisted ID agree. */
export function mapEntityLocator(source, tangent) {
  if (tangent?.kind !== "resource" || !source?.owner || !isSafeResourceId(tangent.ref)) return null;
  return { owner: String(source.owner), id: tangent.ref };
}

/** Splits one vault reference without interpreting resource IDs as vault paths. */
function splitVaultReference(ref) {
  const index = String(ref).indexOf("#");
  return index < 0 ? { file: String(ref), subpath: null } : { file: String(ref).slice(0, index), subpath: String(ref).slice(index) };
}

/** Returns an exact safe URL without normalizing away recorded bytes. */
function safeExternalUrl(value) {
  if (typeof value !== "string" || !value || value.length > 8_000 || CONTROL_CHARACTER.test(value)) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

/** Reports whether one target is an exact validated absolute path. */
function safeAbsolutePath(value) {
  return typeof value === "string" && value.startsWith("/") && value.length <= 32_768 && !CONTROL_CHARACTER.test(value) ? value : null;
}

/** Returns the final non-empty path segment without changing the target. */
function pathLeaf(value) {
  return String(value ?? "").split("/").filter(Boolean).at(-1) || String(value ?? "");
}

/** Returns the host printed for one already validated external URL. */
function urlHost(value) {
  try { return new URL(value).host || "link"; } catch { return "link"; }
}

/** Returns a human branch name from an observed Git ref. */
function branchLabel(checkout) {
  if (checkout?.kind !== "branch") return "";
  return String(checkout.branchRef ?? "").replace(/^refs\/heads\//, "");
}

/**
 * Returns the closed state words a local observation value reports: the path
 * state, then the checkout kind, then the working tree. These words pick an
 * icon; the visible words come from `localPresentation`.
 */
function localStates(value) {
  if (!value) return [];
  const checkout = ["branch", "detached", "bare"].includes(value.checkout?.kind) ? [value.checkout.kind] : [];
  const worktree = value.dirty === true ? ["dirty"] : value.dirty === false ? ["clean"] : [];
  const state = ["available", "missing", "not-a-worktree", "access-denied"].includes(value.state) ? [value.state] : [];
  return [...state, ...checkout, ...worktree];
}

/** Converts a local observation into presentation-only state facts. */
function localPresentation(observation) {
  /** Returns exceptional target state while leaving Available visually quiet. */
  const targetState = (value) => ({
    missing: "Missing",
    "not-a-worktree": "Not a worktree",
    "access-denied": "Access denied",
  })[value?.state] ?? "";
  // An uncommitted change is worth a word; a clean checkout stays quiet, the
  // way Available does.
  /** Returns the exceptional target words, including an uncommitted change. */
  const words = (value) => [targetState(value), value?.dirty === true ? "Dirty" : ""].filter(Boolean);
  if (!observation || observation.state === "not-checked") return { stateText: ["Not checked"], value: null, states: [] };
  if (observation.state === "checking") {
    return { stateText: [...words(observation.value), "Checking"], value: observation.value ?? null, states: ["checking", ...localStates(observation.value)] };
  }
  if (observation.state === "current") return { stateText: words(observation.value), value: observation.value, states: localStates(observation.value) };
  if (observation.state === "last-known") return { stateText: [...words(observation.value), "Last known"], value: observation.value, states: ["last-known", ...localStates(observation.value)] };
  return { stateText: ["Path status unavailable"], value: null, states: ["unavailable"] };
}

/** Converts a provider lifecycle observation without parsing its state label. */
function lifecyclePresentation(observation) {
  const value = observation?.value;
  if (!observation || observation.state === "not-checked" || observation.state === "unavailable") {
    return { stateText: ["Status unavailable"], treatment: null, states: observation ? ["unavailable"] : [] };
  }
  const label = typeof value?.stateLabel === "string" ? value.stateLabel : "";
  const treatment = ["success", "neutral", "muted"].includes(value?.treatment) ? value.treatment : null;
  /** Joins the observation word, the treatment, and the provider's own word. */
  const states = (observationState) => [observationState, treatment, label].filter(Boolean);
  if (observation.state === "checking") return { stateText: [label, "Checking"].filter(Boolean), treatment, states: states("checking") };
  if (observation.state === "last-known") return { stateText: [label, "Last known"].filter(Boolean), treatment, states: states("last-known") };
  return { stateText: [label || "Status unavailable"], treatment: label ? treatment : null, states: label ? states(null) : [] };
}

/** Returns the provider-specific Link kind and compact target clue. */
function linkPresentation(entity) {
  const facet = entity.link;
  if (facet?.kind === "github-pr") return {
    kindLabel: "GitHub PR",
    targetClue: `${facet.owner}/${facet.repository}#${facet.number}`,
    lifecycle: lifecyclePresentation(facet.lifecycle),
  };
  if (facet?.kind === "phabricator-revision") return {
    kindLabel: "Phabricator revision",
    targetClue: facet.revisionId,
    lifecycle: lifecyclePresentation(facet.lifecycle),
  };
  return { kindLabel: "Link", targetClue: urlHost(entity.target.url), lifecycle: { stateText: [], treatment: null, states: [] } };
}

/** Returns all presentation facts while retaining the exact target for actions. */
function currentResourcePresentation(entity) {
  if (entity.target?.kind === "worktree" || entity.target?.kind === "repository") {
    const path = safeAbsolutePath(entity.target.path);
    if (!path) return null;
    const local = localPresentation(entity.local);
    const branch = branchLabel(local.value?.checkout);
    const kindLabel = entity.target.kind === "worktree" ? "Worktree" : "Repository";
    return {
      kindLabel,
      kindId: entity.target.kind,
      states: local.states,
      label: String(entity.label || pathLeaf(path)),
      targetClue: branch || pathLeaf(path),
      target: path,
      stateText: local.stateText,
      treatment: null,
      primaryAction: { kind: "copy-path", resource: entity.locator, path },
      readAction: null,
      actionLabel: "Copy path",
    };
  }
  if (entity.target?.kind === "link") {
    const url = safeExternalUrl(entity.target.url);
    if (!url || !["http:", "https:"].includes(new URL(url).protocol)) return null;
    const link = linkPresentation(entity);
    const targetLabel = link.kindLabel === "GitHub PR" ? `PR ${entity.link.number}`
      : link.kindLabel === "Phabricator revision" ? entity.link.revisionId
        : urlHost(url);
    const action = { kind: "open-url", resource: entity.locator, url, targetLabel };
    return {
      kindLabel: link.kindLabel,
      kindId: ["github-pr", "phabricator-revision"].includes(entity.link?.kind) ? entity.link.kind : "link",
      states: link.lifecycle.states ?? [],
      label: String(entity.label || link.targetClue || urlHost(url)),
      targetClue: link.targetClue,
      target: url,
      stateText: link.lifecycle.stateText,
      treatment: link.lifecycle.treatment,
      primaryAction: action,
      readAction: action,
      actionLabel: link.kindLabel === "GitHub PR" ? "Open PR" : link.kindLabel === "Phabricator revision" ? "Open revision" : "Open",
    };
  }
  return null;
}

/** Returns a deterministic resource fallback when catalog authority is unavailable. */
function unresolvedResource(source, locator, kinds = null) {
  const label = `Resource ${locator.id}`;
  return resolvedEntity({
    source,
    kinds,
    kindId: "resource",
    states: ["unresolved"],
    reference: { kind: "resource", resource: locator },
    kindLabel: "Resource",
    label,
    targetClue: "Target unavailable",
    target: "Target unavailable",
    stateText: ["unresolved"],
    treatment: null,
    primaryAction: null,
    readAction: null,
    actionLabel: null,
    sourceState: "unresolved",
  });
}

/** Returns the entry the Map kinds definition holds for one kind id, if it is usable. */
function kindEntry(kinds, kindId) {
  const entry = (kinds?.kinds ?? []).find((candidate) => candidate?.id === kindId) ?? null;
  return entry && !(entry.problems ?? []).length ? entry : null;
}

/**
 * Returns the action one definition verb names. Every verb is an existing Map
 * action; a verb the resolved target cannot run returns null and the Block
 * keeps its current action.
 */
function actionForVerb(verb, { reference, target, area }) {
  const resource = reference?.kind === "resource" ? reference.resource : null;
  if (verb === "copy-path") { const path = safeAbsolutePath(target); return path ? { kind: "copy-path", resource, path } : null; }
  if (verb === "open") { const url = safeExternalUrl(target); return url ? { kind: "open-url", resource, url, targetLabel: urlHost(url) } : null; }
  if (verb === "details") return resource ? { kind: "details", resource } : null;
  if (reference?.kind !== "vault") return null;
  const file = splitVaultReference(reference.ref);
  if (verb === "open-document") return { kind: "open-document", file: file.file, subpath: file.subpath, mode: "open" };
  if (verb === "open-goal") return { kind: "open-goal", file: file.file };
  if (verb === "open-brain") return area ? { kind: "open-area-brain", area } : null;
  return null;
}

/**
 * Applies the click verb of one definition entry over the kind's own action.
 * Only a current thing takes the verb: a gone Block keeps its last-known
 * action, whose label already says so.
 */
function withKindEntry(facts, entry, { reference, area, sourceState }) {
  if (!entry) return facts;
  const kindLabel = entry.label || facts.kindLabel;
  if (!entry.click || sourceState !== "current") return { ...facts, kindLabel };
  const action = actionForVerb(entry.click, { reference, target: facts.target, area });
  if (!action) return { ...facts, kindLabel };
  return {
    ...facts,
    kindLabel,
    primaryAction: action,
    readAction: action.kind === "open-url" ? action : action.kind === "open-document" ? { ...action, mode: "read" } : null,
    actionLabel: action.kind === facts.primaryAction?.kind ? facts.actionLabel : VERB_LABELS[entry.click],
  };
}

/** Builds the shared accessible and Find facts for one resolved entity. */
function resolvedEntity(input) {
  const { source, reference, kinds = null, kindId = "", area = null, sourceState } = input;
  const facts = withKindEntry(input, kindEntry(kinds, kindId), { reference, area, sourceState });
  const { kindLabel, label, targetClue, target, stateText, treatment, primaryAction, readAction, actionLabel } = facts;
  const states = stateText.length ? stateText : [sourceState === "current" ? "Current" : sourceState];
  const owner = source.owner || "unknown";
  return {
    source,
    reference,
    kindId,
    states: [...(input.states ?? [])],
    display: { kindLabel, label, targetClue, stateText: [...stateText], externalTreatment: treatment, actionLabel },
    accessibleName: `${kindLabel}: ${label}. ${states.join(". ")}. Area ${owner}. Target ${target}`,
    searchText: [kindLabel, label, targetClue, target, ...states, owner].filter(Boolean).join(" "),
    primaryAction,
    readAction,
    sourceState,
  };
}

/** Returns the current/gone resolution only when it names the exact source locator. */
function matchingResourceResolution(resolution, locator) {
  const value = resolution?.state === "current" || resolution?.state === "gone" ? resolution.value : null;
  if (!value?.locator || resourceLocatorKey(value.locator) !== resourceLocatorKey(locator)) return null;
  return { state: resolution.state, value };
}

/** Resolves a Resource Block from authoritative catalog projection facts. */
function resolveResource({ source, tangent, resolution, kinds }) {
  const locator = mapEntityLocator(source, tangent);
  if (!locator) return null;
  const matched = matchingResourceResolution(resolution, locator);
  if (!matched) return unresolvedResource(source, locator, kinds);
  if (matched.state === "current") {
    const facts = currentResourcePresentation(matched.value);
    if (!facts) return unresolvedResource(source, locator, kinds);
    return resolvedEntity({
      source,
      kinds,
      reference: { kind: "resource", resource: locator },
      ...facts,
      sourceState: "current",
    });
  }
  const lastKnown = matched.value.lastKnown;
  if (!lastKnown?.target) {
    return resolvedEntity({
      source, kinds, kindId: "resource", states: ["gone"],
      reference: { kind: "resource", resource: locator },
      kindLabel: "Resource",
      label: lastKnown?.label || `Resource ${locator.id}`,
      targetClue: "Target unavailable",
      target: "Target unavailable",
      stateText: ["gone"], treatment: null, primaryAction: null, readAction: null, actionLabel: "Hide Block", sourceState: "gone",
    });
  }
  const label = String(lastKnown.label || (lastKnown.target.kind === "link" ? urlHost(lastKnown.target.url) : pathLeaf(lastKnown.target.path)));
  if (lastKnown.target.kind === "link") {
    const url = safeExternalUrl(lastKnown.target.url);
    if (!url || !["http:", "https:"].includes(new URL(url).protocol)) return unresolvedResource(source, locator, kinds);
    const targetLabel = urlHost(url);
    const action = { kind: "open-url", resource: locator, url, targetLabel };
    return resolvedEntity({
      source, kinds, kindId: "link", states: ["gone"],
      reference: { kind: "resource", resource: locator }, kindLabel: "Link", label,
      targetClue: targetLabel, target: url, stateText: ["gone"], treatment: null,
      primaryAction: action, readAction: action, actionLabel: "Open last known link", sourceState: "gone",
    });
  }
  const path = safeAbsolutePath(lastKnown.target.path);
  if (!path) return unresolvedResource(source, locator, kinds);
  return resolvedEntity({
    source, kinds, kindId: lastKnown.target.kind, states: ["gone"],
    reference: { kind: "resource", resource: locator },
    kindLabel: lastKnown.target.kind === "worktree" ? "Worktree" : "Repository", label,
    targetClue: pathLeaf(path), target: path, stateText: ["gone"], treatment: null,
    primaryAction: { kind: "copy-path", resource: locator, path }, readAction: null,
    actionLabel: "Copy last known path", sourceState: "gone",
  });
}

/** Resolves a generic URL Block while retaining its composed source owner. */
function resolveLink({ source, tangent, kinds }) {
  const url = safeExternalUrl(tangent.ref);
  if (!url) return null;
  const targetLabel = urlHost(url);
  const action = { kind: "open-url", resource: null, url, targetLabel };
  return resolvedEntity({
    source, kinds, kindId: "link", states: [],
    reference: { kind: "link", url }, kindLabel: "Link", label: targetLabel,
    targetClue: targetLabel, target: url, stateText: [], treatment: null,
    primaryAction: action, readAction: action, actionLabel: "Open", sourceState: "current",
  });
}

/**
 * Resolves a placed vault commit. Nothing indexes `vault@<sha>`, so the Block
 * used to resolve as gone and print a stale cached subject. It now reads as
 * what it is: a current commit, named by its short SHA, with no action until a
 * commit reader exists.
 */
function resolveCommit({ source, tangent, kinds, sha }) {
  return resolvedEntity({
    source, kinds, kindId: "commit", states: [],
    reference: { kind: "vault", entityKind: "commit", ref: tangent.ref },
    kindLabel: "Commit", label: sha.slice(0, 8), targetClue: "vault", target: tangent.ref,
    stateText: [], treatment: null, primaryAction: null, readAction: null, actionLabel: null,
    sourceState: "current",
  });
}

/** Resolves one existing vault Block from the trusted navigation projection. */
function resolveVault({ source, tangent, documents, kinds }) {
  const commit = tangent.kind === "commit" ? VAULT_COMMIT_REF.exec(tangent.ref) : null;
  if (commit) return resolveCommit({ source, tangent, kinds, sha: commit[1] });
  const reference = splitVaultReference(tangent.ref);
  if (!reference.file || reference.file.startsWith("/") || CONTROL_CHARACTER.test(reference.file)) return null;
  const record = (documents ?? []).find((item) => item?.file === reference.file);
  const area = tangent.kind === "area" ? reference.file.replace(/\/[^/]+\.md$/, "") : record?.area ?? source.owner;
  const label = String(record?.title || record?.name || reference.file.split("/").at(-1)?.replace(/\.md$/, "") || reference.file);
  const stateText = record?.status ? [String(record.status)] : record ? [] : ["gone"];
  let primaryAction = null; let readAction = null; let actionLabel = null;
  if (tangent.kind === "goal") {
    primaryAction = { kind: "open-goal", file: reference.file };
    readAction = { kind: "open-document", file: reference.file, subpath: reference.subpath, mode: "read" };
    actionLabel = "Open Goal";
  } else if (tangent.kind === "area") {
    primaryAction = area ? { kind: "open-area-brain", area } : null;
    actionLabel = primaryAction ? "Open Brain" : null;
  } else {
    primaryAction = { kind: "open-document", file: reference.file, subpath: reference.subpath, mode: "open" };
    readAction = { ...primaryAction, mode: "read" };
    actionLabel = "Open Document";
  }
  return resolvedEntity({
    source, kinds, area, kindId: tangent.kind,
    states: [...(record ? [] : ["gone"]), ...(record?.live || record?.sessionState === "live" ? ["live"] : [])],
    reference: { kind: "vault", entityKind: tangent.kind, ref: tangent.ref },
    kindLabel: tangent.kind === "goal" ? "Goal" : tangent.kind === "area" ? "Area" : "Document",
    label, targetClue: reference.subpath || reference.file, target: tangent.ref,
    stateText, treatment: null, primaryAction, readAction, actionLabel,
    sourceState: record ? "current" : "gone",
  });
}

/**
 * Converts persisted metadata and supplied live facts into the one exhaustive
 * browser entity model. It performs no I/O and never mutates the scene.
 */
export function resolveMapEntity(input = {}) {
  const element = input.element ?? null;
  const tangent = input.tangent ?? tangentOf(element);
  const source = sourceOf(input, element);
  if (!source || !tangent || !MAP_ENTITY_KINDS.has(tangent.kind)) return null;
  const kinds = input.kinds ?? null;
  if (tangent.kind === "resource") return resolveResource({ source, tangent, kinds, resolution: input.resource ?? input.resolution ?? null });
  if (tangent.kind === "link") return resolveLink({ source, tangent, kinds });
  return resolveVault({ source, tangent, kinds, documents: input.documents ?? [] });
}

/** Returns the browser-owned effects without importing browser globals in tests. */
function browserEffects(effects) {
  return {
    clipboard: effects?.clipboard ?? globalThis.navigator?.clipboard ?? null,
    openWindow: effects?.openWindow ?? globalThis.open?.bind(globalThis) ?? null,
  };
}

/**
 * Runs only browser effects represented by the typed action union. Opening a
 * blank window happens synchronously before this async function can yield.
 */
export async function runMapEntityAction(action, effects = {}) {
  const browser = browserEffects(effects);
  if (action?.kind === "copy-path" || action?.kind === "copy-url") {
    const copy = action.kind === "copy-path"
      ? { kind: "path", value: safeAbsolutePath(action.path) }
      : { kind: "url", value: safeExternalUrl(action.url) };
    if (!copy.value) return { kind: "unavailable" };
    try {
      if (typeof browser.clipboard?.writeText !== "function") throw new Error("clipboard unavailable");
      await browser.clipboard.writeText(copy.value);
      return { kind: "done" };
    } catch {
      return { kind: "clipboard-blocked", copy };
    }
  }
  if (action?.kind === "open-url") {
    const url = safeExternalUrl(action.url);
    if (!url || typeof browser.openWindow !== "function") return { kind: "unavailable" };
    let handle = null;
    try { handle = browser.openWindow("", "_blank"); } catch { /* A thrown open is the same recoverable blocked result. */ }
    const blocked = { kind: "popup-blocked", url, targetLabel: String(action.targetLabel || urlHost(url)) };
    if (!handle) return blocked;
    try {
      handle.opener = null;
      if (typeof handle.location?.replace !== "function") throw new Error("navigation unavailable");
      handle.location.replace(url);
      return { kind: "done" };
    } catch {
      try { handle.close?.(); } catch { /* Recovery must survive a hostile window handle. */ }
      return blocked;
    }
  }
  return { kind: "unavailable" };
}

export default {
  exactlyOneSelectedMapEntity,
  isMapEntityBlock,
  isSafeResourceId,
  mapEntityLocator,
  resolveMapEntity,
  resourceLocatorKey,
  runMapEntityAction,
  selectedMapEntityElement,
};
