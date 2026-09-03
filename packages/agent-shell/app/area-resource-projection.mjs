import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { areaAncestors } from "./area-agent-command.mjs";
import {
  areaResourceLabel,
  areaResourceTargetFingerprint,
  areaResourceWarnings,
  emptyAreaResourceCatalog,
  findAreaResourceRecord,
  normalizeAreaResourceTarget,
  projectAreaResourceCatalogs,
  readAreaResourceCatalog,
  safeAreaResourceOwner,
} from "./area-resource-catalog.mjs";
import { areaNotePath, parseAreaResources } from "./area-resources.mjs";
import { isSafeResourceId } from "./public/area-map-entities.js";

const LEGACY_FIELDS = new Set(["Repository", "Worktree", "Branch"]);
const CATALOG_READ_CODES = new Set(["catalog-load-failed", "catalog-invalid", "catalog-unsupported"]);

/** Returns stable JSON for structured evidence hashes. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hashes exact line text or canonical structured evidence. */
export function areaResourceEvidenceHash(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Splits a note into numbered lines while retaining carriage returns for hashing. */
function noteLines(source) {
  return String(source ?? "").split("\n").map((raw, index) => ({ raw, text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, number: index + 1 }));
}

/** Returns every exact named section, preserving line order and duplicate headings. */
function sections(lines, name) {
  const starts = lines.flatMap((line, index) => line.text.match(new RegExp(`^## ${name}[ \\t]*$`)) ? [index] : []);
  return starts.map((start) => {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) if (/^## /.test(lines[index].text)) { end = index; break; }
    return lines.slice(start + 1, end);
  });
}

/** Parses the value side of one legacy declaration without rewriting its source. */
function legacyValue(value) {
  let text = String(value ?? "").trim();
  if (!text) return { ok: false, message: "The declaration has no value." };
  if (text.startsWith("`")) {
    const closing = text.indexOf("`", 1);
    if (closing < 0) return { ok: false, message: "The declaration has an unmatched backtick." };
    const rest = text.slice(closing + 1).trim();
    if (rest && !/^\(.*\)$/.test(rest)) return { ok: false, message: "The declaration has ambiguous text after its value." };
    text = text.slice(1, closing).trim();
  } else {
    text = text.replace(/[ \t]+\(.*\)[ \t]*$/, "").trim();
  }
  return text ? { ok: true, value: text } : { ok: false, message: "The declaration has no value." };
}

/** Finds exact Repository, Worktree, and Branch lines in legacy Resources sections. */
function legacyDeclarations(lines) {
  const found = new Map([...LEGACY_FIELDS].map((field) => [field, []]));
  for (const line of sections(lines, "Resources").flat()) {
    const match = line.text.match(/^\s*(?:-\s*)?(Repository|Worktree|Branch)[ \t]*:[ \t]*(.*)$/i);
    if (!match) continue;
    const field = [...LEGACY_FIELDS].find((candidate) => candidate.toLowerCase() === match[1].toLowerCase());
    found.get(field).push({ ...line, parsed: legacyValue(match[2]) });
  }
  return found;
}

/** Returns the exact decision identity match used to hide a reviewed suggestion. */
function hasSuggestionDecision(catalog, item) {
  return (catalog?.suggestionDecisions ?? []).some((decision) => {
    if (decision?.evidenceHash !== item.evidenceHash || decision?.targetFingerprint !== item.targetFingerprint) return false;
    if (decision?.evidence?.kind !== item.evidence.kind) return false;
    return item.evidence.kind !== "legacy-area-binding" || decision.evidence.field === item.evidence.field;
  });
}

/** Returns a human fallback for one suggestion target. */
function suggestionLabel(target) {
  if (target.kind === "link") {
    try { return new URL(target.url).hostname; } catch { return target.url; }
  }
  return path.basename(target.path) || target.path;
}

/** Masks an already consumed line range so another token grammar cannot claim it. */
function maskRange(text, start, end) {
  return `${text.slice(0, start)}${" ".repeat(end - start)}${text.slice(end)}`;
}

/** Removes sentence punctuation without truncating a balanced target parenthesis. */
function trimKnowledgeToken(token) {
  let value = token.replace(/[.,;!]+$/, "");
  while (value.endsWith(")")) {
    const opens = [...value].filter((character) => character === "(").length;
    const closes = [...value].filter((character) => character === ")").length;
    if (closes <= opens) break;
    value = value.slice(0, -1);
  }
  return value;
}

/** Converts one raw path or URL token into a normalized suggestion target. */
function suggestionTarget(token, home) {
  const value = String(token ?? "").trim();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) return normalizeAreaResourceTarget({ kind: "link", url: value });
    if (value.startsWith("/") || value === "~" || value.startsWith("~/")) {
      return normalizeAreaResourceTarget({ kind: "local-path", path: value }, { home, allowLocalPath: true });
    }
  } catch { /* An invalid candidate is not an unambiguous Knowledge target. */ }
  return null;
}

/** Extracts exactly one conservative target from a free-form Knowledge line. */
function knowledgeTarget(line, home) {
  let masked = line;
  const candidates = [];
  /** Claims and masks one normalized target token. */
  const claim = (match, token, offset = 0) => {
    const target = suggestionTarget(token, home);
    if (!target) return;
    const start = match.index + offset;
    const end = start + token.length;
    candidates.push(target);
    masked = maskRange(masked, start, end);
  };

  const code = [...masked.matchAll(/`([^`\r\n]+)`/g)];
  for (const match of code) claim(match, match[1], 1);
  const markdown = [...masked.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)];
  for (const match of markdown) claim(match, match[1], 2);
  const urls = [...masked.matchAll(/(^|[\s:=,(<"'])((?:https?:\/\/[^\s<>\[\]{}"'`]+))/gi)];
  for (const match of urls) {
    const token = trimKnowledgeToken(match[2]);
    claim(match, token, match[1].length);
  }
  const paths = [...masked.matchAll(/(^|[\s=,(])((?:~\/|\/(?!\/))[^\s<>\[\]{}"'`]+)/g)];
  for (const match of paths) {
    const token = trimKnowledgeToken(match[2]);
    claim(match, token, match[1].length);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/** Scans exact Knowledge sections without classifying local paths as repositories. */
function knowledgeSuggestions(owner, lines, catalog, home) {
  const suggestions = [];
  const seen = new Set();
  for (const section of sections(lines, "Knowledge")) {
    let fenced = false;
    for (const line of section) {
      if (/^\s*(?:```|~~~)/.test(line.text)) { fenced = !fenced; continue; }
      if (fenced || !line.text.trim()) continue;
      const target = knowledgeTarget(line.text, home);
      if (!target) continue;
      const evidence = { kind: "knowledge-line" };
      const evidenceHash = areaResourceEvidenceHash(line.raw);
      const targetFingerprint = areaResourceTargetFingerprint(target, { home });
      const identity = `${evidenceHash}\0${targetFingerprint}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const item = {
        owner,
        target,
        evidence,
        evidenceHash,
        targetFingerprint,
        proposedLabel: suggestionLabel(target),
        provenanceLabel: line.text.trim(),
        sourceLine: line.raw,
        lineNumber: line.number,
      };
      if (!hasSuggestionDecision(catalog, item)) suggestions.push(item);
    }
  }
  return suggestions;
}

/** Builds reviewed legacy candidates, invalid rows, and note-only launch facts. */
function legacyReview(owner, lines, catalog, home) {
  const declarations = legacyDeclarations(lines);
  const review = [];
  const values = {};
  for (const field of LEGACY_FIELDS) {
    const matches = declarations.get(field);
    if (matches.length > 1) {
      review.push({ state: "invalid", owner, field, message: `The Area note has more than one ${field} declaration.` });
      values[field] = null;
      continue;
    }
    if (!matches.length) { values[field] = null; continue; }
    const declaration = matches[0];
    if (!declaration.parsed.ok) {
      review.push({ state: "invalid", owner, field, message: `${field}: ${declaration.parsed.message}` });
      values[field] = null;
      continue;
    }
    values[field] = { value: declaration.parsed.value, line: declaration };
  }

  let branch = values.Branch?.value ?? null;
  if (branch?.includes("\0")) {
    review.push({ state: "invalid", owner, field: "Branch", message: "Branch: The declaration is unsafe." });
    branch = null;
  }
  if (branch && !values.Repository && !values.Worktree) {
    review.push({ state: "invalid", owner, field: "Branch", message: "The Branch declaration has no Repository or Worktree to review." });
  }
  for (const [field, kind] of [["Repository", "repository"], ["Worktree", "worktree"]]) {
    const declaration = values[field];
    if (!declaration) continue;
    let target;
    try { target = normalizeAreaResourceTarget({ kind, path: declaration.value }, { home }); }
    catch {
      review.push({ state: "invalid", owner, field, message: `${field}: The declaration must be an absolute or home-relative path.` });
      values[field] = null;
      continue;
    }
    const evidence = { kind: "legacy-area-binding", field };
    const evidenceHash = areaResourceEvidenceHash({ field, line: declaration.line.raw, branchLine: values.Branch?.line.raw ?? null });
    const targetFingerprint = areaResourceTargetFingerprint(target, { home });
    const item = {
      state: "candidate",
      owner,
      target,
      evidence,
      evidenceHash,
      targetFingerprint,
      proposedLabel: suggestionLabel(target),
      provenanceLabel: `${field} in ${owner}`,
      declaredBranch: branch,
      sourceLine: declaration.line.raw,
      lineNumber: declaration.line.number,
    };
    if (!hasSuggestionDecision(catalog, item)) review.push(item);
  }
  return {
    review,
  };
}

/** Normalizes only absolute launch paths while preserving the legacy parser's selection. */
function legacyLaunch(noteText) {
  const parsed = parseAreaResources(noteText);
  /** Normalizes one legacy path when it is eligible for target comparison. */
  const normalize = (kind, value) => {
    if (!value) return null;
    try { return normalizeAreaResourceTarget({ kind, path: value }).path; }
    catch { return value; }
  };
  return { repository: normalize("repository", parsed.repository), worktree: normalize("worktree", parsed.worktree), branch: parsed.branch };
}

/** Reads all pure legacy and Knowledge evidence from one exact Area note. */
export function readAreaResourceNoteEvidence(owner, noteText, { catalog = emptyAreaResourceCatalog(), home = os.homedir() } = {}) {
  const safeOwner = safeAreaResourceOwner(owner);
  if (!safeOwner || typeof noteText !== "string") throw Object.assign(new Error("Area resource evidence needs one safe owner and exact note text."), { code: "invalid-resource-request" });
  const lines = noteLines(noteText);
  const legacy = legacyReview(safeOwner, lines, catalog, home);
  const suggestions = knowledgeSuggestions(safeOwner, lines, catalog, home);
  return {
    owner: safeOwner,
    legacyReview: legacy.review,
    suggestions,
    launch: legacyLaunch(noteText),
    decisions: structuredClone(catalog.suggestionDecisions ?? []),
  };
}

/** Creates one source-owned derived-fact error without exposing filesystem details. */
function projectionError(source, owner, code) {
  return {
    source,
    owner,
    code,
    message: source === "area-note" ? `The Area note for ${owner} could not be ${code === "resource-source-invalid" ? "read safely" : "loaded"}.`
      : `The Map source for ${owner} could not be ${code === "resource-source-invalid" ? "read safely" : "loaded"}.`,
    retryable: code === "resource-source-load-failed",
  };
}

/** Normalizes one injected exact note read into the projection fact union. */
async function readNoteFact(owner, reader) {
  let value;
  try {
    value = await reader(owner);
  } catch (error) {
    const code = error?.code === "resource-source-invalid" ? "resource-source-invalid" : "resource-source-load-failed";
    return { state: "unavailable", owner, error: projectionError("area-note", owner, code) };
  }
  const candidate = value?.state === "current" ? value.text ?? value.content : value?.ok !== false ? value?.text ?? value?.content ?? value : null;
  if (typeof candidate === "string") return { state: "current", owner, text: candidate };
  if (Buffer.isBuffer(candidate) || candidate instanceof Uint8Array) {
    try { return { state: "current", owner, text: new TextDecoder("utf-8", { fatal: true }).decode(candidate) }; }
    catch { return { state: "unavailable", owner, error: projectionError("area-note", owner, "resource-source-invalid") }; }
  }
  const code = value?.ok === false || value?.error?.code === "resource-source-invalid" ? "resource-source-invalid" : "resource-source-load-failed";
  return { state: "unavailable", owner, error: projectionError("area-note", owner, code) };
}

/** Scans raw source elements into one visible-or-hidden representation per ref. */
export function readAreaResourceRepresentations(owner, scene) {
  if (!scene || typeof scene !== "object" || !Array.isArray(scene.elements)) {
    return { state: "unavailable", owner, error: projectionError("source-scene", owner, "resource-source-invalid") };
  }
  const representations = new Map();
  const byId = new Map(scene.elements.map((candidate) => [candidate?.id, candidate]));
  for (const element of scene.elements) {
    const tangent = element?.customData?.tangent;
    if (tangent?.kind !== "resource") continue;
    if (!isSafeResourceId(tangent.ref) || element.containerId || representations.has(tangent.ref)) {
      return { state: "unavailable", owner, error: projectionError("source-scene", owner, "resource-source-invalid") };
    }
    const labels = (element.boundElements ?? []).filter((binding) => binding?.type === "text").map((binding) => byId.get(binding.id)).filter(Boolean);
    if (labels.some((label) => Boolean(label.isDeleted) !== Boolean(element.isDeleted))) {
      return { state: "unavailable", owner, error: projectionError("source-scene", owner, "resource-source-invalid") };
    }
    representations.set(tangent.ref, element.isDeleted ? "hidden" : "on-map");
  }
  return { state: "current", owner, representations };
}

/** Normalizes one injected raw source read and validates resource representation. */
async function readSourceFact(owner, reader) {
  if (typeof reader !== "function") return { state: "unavailable", owner, error: projectionError("source-scene", owner, "resource-source-load-failed") };
  try {
    const value = await reader(owner);
    if (value?.state === "unavailable") {
      const code = value.error?.code === "resource-source-invalid" ? "resource-source-invalid" : "resource-source-load-failed";
      return { state: "unavailable", owner, error: projectionError("source-scene", owner, code) };
    }
    if (value?.ok === false) return { state: "unavailable", owner, error: projectionError("source-scene", owner, "resource-source-invalid") };
    const scene = value?.scene ?? value?.canvas ?? (value?.elements ? value : value == null || value?.exists === false ? { elements: [] } : null);
    return readAreaResourceRepresentations(owner, scene);
  } catch (error) {
    const code = error?.code === "resource-source-invalid" ? "resource-source-invalid" : "resource-source-load-failed";
    return { state: "unavailable", owner, error: projectionError("source-scene", owner, code) };
  }
}

/** Normalizes one injected catalog read and bounds thrown filesystem failures. */
async function readCatalogFact(owner, reader) {
  try {
    const value = await reader(owner);
    if (value?.state === "current" || value?.state === "unavailable") return value;
  } catch (error) {
    const code = CATALOG_READ_CODES.has(error?.code) ? error.code : "catalog-load-failed";
    const messages = {
      "catalog-load-failed": `Map resources for ${owner} could not be loaded.`,
      "catalog-invalid": `Map resources for ${owner} are invalid.`,
      "catalog-unsupported": `Map resources for ${owner} use a newer format.`,
    };
    return { state: "unavailable", owner, error: { owner, code, message: messages[code], retryable: code === "catalog-load-failed" && error?.retryable !== false } };
  }
  return {
    state: "unavailable",
    owner,
    error: { owner, code: "catalog-load-failed", message: `Map resources for ${owner} could not be loaded.`, retryable: true },
  };
}

/** Returns a cache-only observation projection, never a refresh. */
function observedFacets(observations, resource) {
  if (observations?.project) {
    try { return observations.project(resource); } catch { /* Cache projection failure degrades to an unchecked fact. */ }
  }
  const notChecked = { state: "not-checked", value: null, checkedAt: null };
  return resource.target.kind === "link" ? { local: null, link: { kind: "generic" } } : { local: notChecked, link: null };
}

/** Returns an observed branch name without treating it as catalog authority. */
function observedBranch(observation) {
  const checkout = observation?.value?.checkout;
  return checkout?.kind === "branch" ? String(checkout.branchRef ?? "").replace(/^refs\/heads\//, "") : "";
}

/** Applies the accepted kind-specific fallback label order. */
function projectedLabel(record, facets) {
  if (record.label) return record.label;
  if (record.target.kind === "worktree") return observedBranch(facets.local) || (record.origin?.kind === "legacy-area-binding" ? record.origin.declaredBranch : null) || areaResourceLabel(record);
  if (record.target.kind === "link") {
    if (facets.link?.kind === "github-pr") return `${facets.link.owner}/${facets.link.repository}#${facets.link.number}`;
    if (facets.link?.kind === "phabricator-revision") return facets.link.revisionId;
  }
  return areaResourceLabel(record);
}

/** Builds one canonical current entity from catalog, source, and cache facts. */
function currentEntity(record, locator, representation, observations, warnings) {
  const resource = { locator, membership: record.membership, target: record.target };
  const facets = observedFacets(observations, resource);
  return {
    locator,
    label: projectedLabel(record, facets),
    target: record.target,
    representation,
    origin: record.origin,
    warnings,
    local: record.target.kind === "link" ? null : facets.local,
    link: record.target.kind === "link" ? facets.link : null,
  };
}

/** Returns the source representation fact for one active catalog record. */
function representationFact(source, id) {
  return source?.state === "current"
    ? { state: "current", value: source.representations.get(id) ?? "never-placed" }
    : { state: "unavailable", error: source?.error };
}

/** Selects the note-only launch path and nearest error with legacy precedence. */
function launchBinding(owners, evidence, notes) {
  for (const owner of owners) {
    const note = notes.get(owner);
    if (note?.state !== "current") return { binding: null, error: note?.error ?? projectionError("area-note", owner, "resource-source-load-failed") };
    const launch = evidence.get(owner)?.launch;
    if (launch?.worktree) return { binding: launch.worktree, error: null };
    if (launch?.repository) return { binding: launch.repository, error: null };
  }
  return { binding: null, error: null };
}

/** Returns current false rather than inventing a target for a missing-record ghost. */
function launchMatch(target, binding, noteError) {
  if (noteError) return { state: "unavailable", error: noteError };
  if (!target || target.kind === "link" || !binding) return { state: "current", value: false };
  return { state: "current", value: normalizeAreaResourceTarget(target).path === binding };
}

/** Returns the current or retained target used only to group one inventory row. */
function panelRowTarget(row) { return row?.entity?.target ?? row?.entity?.lastKnown?.target ?? null; }

/** Returns the saved representation word from either current or gone row shapes. */
function panelRowRepresentation(row) {
  const value = row?.entity?.representation;
  return typeof value === "string" ? value : value?.state === "current" ? value.value : "unavailable";
}

/** Orders every caller's inventory by the accepted direct, removed, and inherited groups. */
function sortPanelRows(rows) {
  /** Assigns direct local, direct Link, removed, then inherited group order. */
  const group = (row) => {
    if (row?.relation?.kind === "inherited") return 3;
    if (row?.entity?.reason) return 2;
    return panelRowTarget(row)?.kind === "link" ? 1 : 0;
  };
  /** Orders launch, live Map representation, then label inside a direct group. */
  const priority = (row) => row?.launchMatch?.state === "current" && row.launchMatch.value === true
    ? 0
    : panelRowRepresentation(row) === "on-map" ? 1 : 2;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftGroup = group(left.row); const rightGroup = group(right.row);
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      if (leftGroup < 3) {
        const ranked = priority(left.row) - priority(right.row);
        if (ranked) return ranked;
        const leftLabel = left.row.entity?.label || left.row.entity?.lastKnown?.label || "\uffff";
        const rightLabel = right.row.entity?.label || right.row.entity?.lastKnown?.label || "\uffff";
        const labelled = leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
        if (labelled) return labelled;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

/** Adds one owner/source problem only once. */
function addProblem(problems, problem) {
  const error = problem.error;
  const key = `${problem.kind}\0${error?.source ?? "catalog"}\0${error?.owner ?? ""}\0${error?.code ?? ""}`;
  if (!problems.some((item) => item.key === key)) problems.push({ key, value: problem });
}

/** Joins exact catalog, note, source, and cache snapshots into the panel contract. */
export async function readAreaResourcePanelProjection({ area, readCatalog, readNote, readSource, observations, home = os.homedir() }) {
  const viewedFrom = safeAreaResourceOwner(area);
  if (!viewedFrom) throw Object.assign(new Error("A safe selected Area is required."), { code: "invalid-resource-request", status: 400 });
  const owners = areaAncestors(viewedFrom);
  const catalogReads = await Promise.all(owners.map((owner) => readCatalogFact(owner, readCatalog)));
  const base = projectAreaResourceCatalogs(viewedFrom, catalogReads);
  if (base.state === "unavailable") return base;

  const catalogs = new Map(catalogReads.filter((read) => read.state === "current").map((read) => [read.owner, read]));
  const noteReads = await Promise.all(owners.map((owner) => readNoteFact(owner, readNote)));
  const notes = new Map(noteReads.map((read) => [read.owner, read]));
  const evidence = new Map();
  for (const owner of owners) {
    const note = notes.get(owner);
    const catalog = catalogs.get(owner);
    if (note?.state === "current") evidence.set(owner, readAreaResourceNoteEvidence(owner, note.text, { catalog: catalog?.catalog ?? emptyAreaResourceCatalog(), home }));
  }

  const sourceOwners = new Set([viewedFrom, ...base.rows.map((row) => row.locator.owner)]);
  const sourceReads = await Promise.all([...sourceOwners].map((owner) => readSourceFact(owner, readSource)));
  const sources = new Map(sourceReads.map((read) => [read.owner, read]));
  const launch = launchBinding(owners, evidence, notes);
  const rows = base.rows.map((row) => ({
    viewedFrom,
    relation: row.relation,
    alsoFrom: row.alsoFrom,
    launchMatch: launchMatch(row.record.target, launch.binding, launch.error),
    entity: currentEntity(
      row.record,
      row.locator,
      representationFact(sources.get(row.locator.owner), row.locator.id),
      observations,
      row.warnings,
    ),
  }));

  const directCatalog = catalogs.get(viewedFrom)?.catalog;
  const directSource = sources.get(viewedFrom);
  if (directCatalog && directSource?.state === "current") {
    for (const [id, representation] of directSource.representations) {
      if (representation !== "on-map") continue;
      const existing = findAreaResourceRecord(directCatalog, id);
      if (existing?.membership?.state === "active") continue;
      const locator = { owner: viewedFrom, id };
      const removed = existing?.membership?.state === "removed";
      const entity = {
        locator,
        reason: removed ? "removed" : "missing-record",
        lastKnown: removed ? { label: areaResourceLabel(existing), target: existing.target } : null,
        representation: "on-map",
        warnings: [],
      };
      rows.push({
        viewedFrom,
        relation: { kind: "direct" },
        alsoFrom: [],
        launchMatch: launchMatch(removed ? existing.target : null, launch.binding, launch.error),
        entity,
      });
    }
  }
  const orderedRows = sortPanelRows(rows);

  const problems = [];
  for (const error of base.problems ?? []) addProblem(problems, { kind: "catalog", error });
  for (const read of noteReads) if (read.state !== "current") addProblem(problems, { kind: "projection", error: read.error });
  for (const read of sourceReads) if (read.state !== "current") addProblem(problems, { kind: "projection", error: read.error });
  const legacy = owners.flatMap((owner) => catalogs.has(owner) ? evidence.get(owner)?.legacyReview ?? [] : []);
  const suggestions = owners.flatMap((owner) => catalogs.has(owner) ? evidence.get(owner)?.suggestions ?? [] : []);
  const confirmed = base.counts.state === "current" ? base.counts.confirmedAssociations : base.counts.confirmedAssociationsAtLeast;
  if (problems.length) {
    return {
      state: "partial",
      rows: orderedRows,
      catalogs: base.catalogs,
      legacyReview: legacy,
      suggestions,
      counts: {
        state: "lower-bound",
        confirmedAssociationsAtLeast: confirmed,
        suggestionsAtLeast: suggestions.length,
        legacyReviewAtLeast: legacy.length,
      },
      problems: problems.map((item) => item.value),
    };
  }
  return {
    state: "current",
    rows: orderedRows,
    catalogs: base.catalogs,
    legacyReview: legacy,
    suggestions,
    counts: { state: "current", confirmedAssociations: confirmed, suggestions: suggestions.length, legacyReview: legacy.length },
  };
}

/** Returns a validated last-known action target supplied by retained browser state. */
function retainedLastKnown(value) {
  if (!value || typeof value !== "object" || typeof value.label !== "string") return null;
  try { areaResourceTargetFingerprint(value.target); return { label: value.label, target: value.target }; }
  catch { return null; }
}

/** Returns one requested locator and its retained representation facts. */
function requestedLocator(value) {
  const locator = value?.locator ?? value;
  if (!safeAreaResourceOwner(locator?.owner) || !isSafeResourceId(locator?.id)) return null;
  return {
    locator: { owner: locator.owner, id: locator.id },
    representation: ["on-map", "hidden"].includes(value?.representation) ? value.representation : "on-map",
    lastKnown: retainedLastKnown(value?.lastKnown),
  };
}

/** Resolves an ordered locator collection from exact catalog/source and cache facts. */
export async function resolveAreaResourceLocators({ locators, readCatalog, readSource, observations, ownerExists = () => true }) {
  if (!Array.isArray(locators) || locators.length > 500) throw Object.assign(new Error("Resource resolution accepts at most 500 locators."), { code: "invalid-resource-request", status: 400 });
  const requested = locators.map(requestedLocator);
  if (requested.some((item) => !item)) throw Object.assign(new Error("Every resource locator must have one safe owner and ID."), { code: "invalid-resource-request", status: 422 });
  const owners = [...new Set(requested.map((item) => item.locator.owner))];
  const existence = new Map(await Promise.all(owners.map(async (owner) => [owner, Boolean(await ownerExists(owner))])));
  const existingOwners = owners.filter((owner) => existence.get(owner));
  const catalogReads = await Promise.all(existingOwners.map((owner) => readCatalogFact(owner, readCatalog)));
  const currentOwners = catalogReads.filter((read) => read.state === "current").map((read) => read.owner);
  const sourceReads = await Promise.all(currentOwners.map((owner) => readSourceFact(owner, readSource)));
  const catalogs = new Map(catalogReads.map((read) => [read.owner, read]));
  const sources = new Map(sourceReads.map((read) => [read.owner, read]));
  const resolutions = requested.map((request) => {
    const { locator } = request;
    if (!existence.get(locator.owner)) {
      return { state: "gone", value: { locator, reason: "missing-owner", lastKnown: request.lastKnown, representation: request.representation, warnings: [] } };
    }
    const catalogRead = catalogs.get(locator.owner);
    if (catalogRead?.state !== "current") return { state: "unavailable", locator, error: catalogRead.error };
    const record = findAreaResourceRecord(catalogRead.catalog, locator.id);
    const source = sources.get(locator.owner);
    const represented = source?.state === "current" ? source.representations.get(locator.id) : null;
    if (!record) {
      return { state: "gone", value: { locator, reason: "missing-record", lastKnown: request.lastKnown, representation: represented ?? request.representation, warnings: [] } };
    }
    if (record.membership.state === "removed") {
      return {
        state: "gone",
        value: {
          locator,
          reason: "removed",
          lastKnown: { label: areaResourceLabel(record), target: record.target },
          representation: represented ?? request.representation,
          warnings: [],
        },
      };
    }
    return {
      state: "current",
      value: currentEntity(
        record,
        locator,
        representationFact(source, locator.id),
        observations,
        areaResourceWarnings(catalogRead.catalog, locator.owner, locator.id),
      ),
    };
  });
  return {
    resolutions,
    catalogs: catalogReads.filter((read) => read.state === "current").map((read) => ({ owner: read.owner, revision: read.revision })),
  };
}

/** Converts a string or route input into one exact Area owner. */
function inputArea(value) { return typeof value === "string" ? value : value?.area; }

/** Throws one source-owned read error in the mutation coordinator vocabulary. */
function throwEvidenceRead(error) {
  throw Object.assign(new Error(error.message), error, {
    status: error.code === "catalog-load-failed" || error.code === "resource-source-load-failed" ? 503 : 409,
  });
}

/** Creates the read-only resource projection operations used by private routes. */
export function createAreaResourceProjection({
  root,
  transactions = null,
  repository = null,
  observations = null,
  readCatalog = null,
  readNote = null,
  readSource = null,
  ownerExists = null,
  home = os.homedir(),
} = {}) {
  const catalogReader = readCatalog ?? ((owner) => readAreaResourceCatalog(root, owner));
  const noteReader = readNote ?? (async (owner) => readFile(areaNotePath(root, owner)));
  const sourceReader = readSource ?? (transactions?.read ? (owner) => transactions.read(owner) : repository?.read ? (owner) => repository.read(owner) : null);
  const existenceReader = ownerExists ?? (() => true);
  /** Runs a complete read under the exact transaction reader barrier. */
  const snapshot = (operation) => transactions?.withRead ? transactions.withRead(operation) : operation();

  /** Reads one selected panel projection without starting discovery or observation work. */
  async function read(input) {
    const area = inputArea(input);
    if (!safeAreaResourceOwner(area)) throw Object.assign(new Error("A safe selected Area is required."), { code: "invalid-resource-request", status: 400 });
    return snapshot(async () => {
      if (ownerExists && !await existenceReader(area)) throw Object.assign(new Error(`No Area ${area}.`), { code: "area-not-found", status: 404 });
      return readAreaResourcePanelProjection({ area, readCatalog: catalogReader, readNote: noteReader, readSource: sourceReader, observations, home });
    });
  }

  /** Resolves one ordered locator request without starting an observation. */
  async function resolve(input) {
    const locators = Array.isArray(input) ? input : input?.resources ?? input?.locators;
    return snapshot(() => resolveAreaResourceLocators({ locators, readCatalog: catalogReader, readSource: sourceReader, observations, ownerExists: existenceReader }));
  }

  /** Reads exact note evidence and the catalog decisions used to revalidate it. */
  async function evidence(input, options = {}) {
    const area = inputArea(input);
    if (!safeAreaResourceOwner(area)) throw Object.assign(new Error("A safe Area is required."), { code: "invalid-resource-request", status: 400 });
    const requested = options.owners ?? input?.owners ?? [area];
    if (!Array.isArray(requested) || !requested.length) throw Object.assign(new Error("At least one evidence owner is required."), { code: "invalid-resource-request", status: 400 });
    const allowed = new Set(areaAncestors(area));
    const owners = [...new Set(requested)];
    if (owners.some((owner) => !safeAreaResourceOwner(owner) || !allowed.has(owner))) {
      throw Object.assign(new Error("Evidence owners must be the selected Area or its ancestors."), { code: "invalid-resource-target", status: 422 });
    }
    return snapshot(async () => {
      if (ownerExists && !await existenceReader(area)) throw Object.assign(new Error(`No Area ${area}.`), { code: "area-not-found", status: 404 });
      const reads = await Promise.all(owners.map(async (owner) => {
        const [catalogRead, noteRead] = await Promise.all([readCatalogFact(owner, catalogReader), readNoteFact(owner, noteReader)]);
        if (catalogRead.state !== "current") throwEvidenceRead(catalogRead.error);
        if (noteRead.state !== "current") throwEvidenceRead(noteRead.error);
        return { owner, catalogRead, evidence: readAreaResourceNoteEvidence(owner, noteRead.text, { catalog: catalogRead.catalog, home }) };
      }));
      return {
        state: "current",
        owner: area,
        catalogs: reads.map((read) => ({ owner: read.owner, revision: read.catalogRead.revision })),
        legacyReview: reads.flatMap((read) => read.evidence.legacyReview),
        suggestions: reads.flatMap((read) => read.evidence.suggestions),
        decisions: reads.flatMap((read) => read.evidence.decisions.map((decision) => ({ ...decision, owner: read.owner }))),
        ...(reads.length === 1 ? { catalogRevision: reads[0].catalogRead.revision, launch: reads[0].evidence.launch } : {}),
      };
    });
  }

  return { evidence, read, resolve };
}

export default {
  areaResourceEvidenceHash,
  createAreaResourceProjection,
  readAreaResourceNoteEvidence,
  readAreaResourcePanelProjection,
  readAreaResourceRepresentations,
  resolveAreaResourceLocators,
};
