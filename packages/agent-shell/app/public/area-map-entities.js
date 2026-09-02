const MAP_ENTITY_KINDS = new Set(["goal", "document", "area", "link", "brain", "agent", "person", "request", "commit", "evidence", "resource"]);
const OPAQUE_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** Reports whether one value is safe to use as a catalog-local opaque identity. */
export function isSafeResourceId(value) {
  return typeof value === "string" && OPAQUE_RESOURCE_ID.test(value);
}

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

/** Converts a local observation into presentation-only state facts. */
function localPresentation(observation) {
  /** Returns exceptional target state while leaving Available visually quiet. */
  const targetState = (value) => ({
    missing: "Missing",
    "not-a-worktree": "Not a worktree",
    "access-denied": "Access denied",
  })[value?.state] ?? "";
  if (!observation || observation.state === "not-checked") return { stateText: ["Not checked"], value: null };
  if (observation.state === "checking") {
    const state = targetState(observation.value);
    return { stateText: [state, "Checking"].filter(Boolean), value: observation.value ?? null };
  }
  if (observation.state === "current") return { stateText: [targetState(observation.value)].filter(Boolean), value: observation.value };
  if (observation.state === "last-known") return { stateText: [targetState(observation.value), "Last known"].filter(Boolean), value: observation.value };
  return { stateText: ["Path status unavailable"], value: null };
}

/** Converts a provider lifecycle observation without parsing its state label. */
function lifecyclePresentation(observation) {
  const value = observation?.value;
  if (!observation || observation.state === "not-checked" || observation.state === "unavailable") {
    return { stateText: ["Status unavailable"], treatment: null };
  }
  const label = typeof value?.stateLabel === "string" ? value.stateLabel : "";
  const treatment = ["success", "neutral", "muted"].includes(value?.treatment) ? value.treatment : null;
  if (observation.state === "checking") return { stateText: [label, "Checking"].filter(Boolean), treatment };
  if (observation.state === "last-known") return { stateText: [label, "Last known"].filter(Boolean), treatment };
  return { stateText: [label || "Status unavailable"], treatment: label ? treatment : null };
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
  return { kindLabel: "Link", targetClue: urlHost(entity.target.url), lifecycle: { stateText: [], treatment: null } };
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
function unresolvedResource(source, locator) {
  const label = `Resource ${locator.id}`;
  return resolvedEntity({
    source,
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

/** Builds the shared accessible and Find facts for one resolved entity. */
function resolvedEntity({ source, reference, kindLabel, label, targetClue, target, stateText, treatment, primaryAction, readAction, actionLabel, sourceState }) {
  const states = stateText.length ? stateText : [sourceState === "current" ? "Current" : sourceState];
  const owner = source.owner || "unknown";
  return {
    source,
    reference,
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
function resolveResource({ source, tangent, resolution }) {
  const locator = mapEntityLocator(source, tangent);
  if (!locator) return null;
  const matched = matchingResourceResolution(resolution, locator);
  if (!matched) return unresolvedResource(source, locator);
  if (matched.state === "current") {
    const facts = currentResourcePresentation(matched.value);
    if (!facts) return unresolvedResource(source, locator);
    return resolvedEntity({
      source,
      reference: { kind: "resource", resource: locator },
      ...facts,
      sourceState: "current",
    });
  }
  const lastKnown = matched.value.lastKnown;
  if (!lastKnown?.target) {
    return resolvedEntity({
      source,
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
    if (!url || !["http:", "https:"].includes(new URL(url).protocol)) return unresolvedResource(source, locator);
    const targetLabel = urlHost(url);
    const action = { kind: "open-url", resource: locator, url, targetLabel };
    return resolvedEntity({
      source, reference: { kind: "resource", resource: locator }, kindLabel: "Link", label,
      targetClue: targetLabel, target: url, stateText: ["gone"], treatment: null,
      primaryAction: action, readAction: action, actionLabel: "Open last known link", sourceState: "gone",
    });
  }
  const path = safeAbsolutePath(lastKnown.target.path);
  if (!path) return unresolvedResource(source, locator);
  return resolvedEntity({
    source, reference: { kind: "resource", resource: locator },
    kindLabel: lastKnown.target.kind === "worktree" ? "Worktree" : "Repository", label,
    targetClue: pathLeaf(path), target: path, stateText: ["gone"], treatment: null,
    primaryAction: { kind: "copy-path", resource: locator, path }, readAction: null,
    actionLabel: "Copy last known path", sourceState: "gone",
  });
}

/** Resolves a generic URL Block while retaining its composed source owner. */
function resolveLink({ source, tangent }) {
  const url = safeExternalUrl(tangent.ref);
  if (!url) return null;
  const targetLabel = urlHost(url);
  const action = { kind: "open-url", resource: null, url, targetLabel };
  return resolvedEntity({
    source, reference: { kind: "link", url }, kindLabel: "Link", label: targetLabel,
    targetClue: targetLabel, target: url, stateText: [], treatment: null,
    primaryAction: action, readAction: action, actionLabel: "Open", sourceState: "current",
  });
}

/** Resolves one existing vault Block from the trusted navigation projection. */
function resolveVault({ source, tangent, documents }) {
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
    source, reference: { kind: "vault", entityKind: tangent.kind, ref: tangent.ref },
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
  if (tangent.kind === "resource") return resolveResource({ source, tangent, resolution: input.resource ?? input.resolution ?? null });
  if (tangent.kind === "link") return resolveLink({ source, tangent });
  return resolveVault({ source, tangent, documents: input.documents ?? [] });
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
