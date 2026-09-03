import { createHash } from "node:crypto";

const SIGNALS = new Set(["needs-you", "waiting-on", "moving", "stuck", "quiet"]);
const RELATIONS = new Set(["needs", "feeds", "same-as", "blocks", "shares-branch-with"]);
/** Hashes a value's JSON as sha256 hex. */
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** True for a trimmed, non-empty string no longer than max. */
const short = (value, max) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;
/** True when a source names a bounded file and, if given, a subpath starting with #. */
function sourceValid(source) { return source && short(source.file, 2_000) && (source.subpath === undefined || short(source.subpath, 2_000) && source.subpath.startsWith("#")); }

/** Validates a presented Area picture against its closed vocabulary and limits. */
export function validateAreaPicture(area, input) {
  const errors = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["picture must be an object"] };
  if (input.area !== area) errors.push("picture Area does not match the route Area");
  if (!Array.isArray(input.outcomes) || input.outcomes.length > 12) errors.push("picture must have at most 12 outcomes");
  if (!Array.isArray(input.options) || input.options.length > 5) errors.push("picture must have at most 5 options");
  for (const outcome of input.outcomes ?? []) {
    if (!short(outcome.id, 100) || !short(outcome.outcome, 120) || !short(outcome.next, 160) || !short(outcome.who, 80)) errors.push("each outcome needs bounded id, outcome, next, and who text");
    if (!SIGNALS.has(outcome.signal?.kind) || outcome.signal.kind === "waiting-on" && !short(outcome.signal.person, 80)) errors.push("outcome signal is invalid");
    if (!(outcome.source?.kind === "brain" || sourceValid(outcome.source))) errors.push("outcome source is invalid");
    if (!Array.isArray(outcome.evidence) || !Array.isArray(outcome.relations)) errors.push("outcome evidence and relations must be arrays");
    for (const relation of outcome.relations ?? []) if (!RELATIONS.has(relation.kind) || !short(relation.target, 160) || relation.targetSource && !sourceValid(relation.targetSource)) errors.push("outcome relation is invalid");
  }
  return { ok: errors.length === 0, errors };
}

/** Creates the Area picture operations over a record store. */
export function createAreaPictures({ store, now = () => new Date().toISOString() }) {
  const name = "picture.json";
  /** Reads the current picture of an Area, or null. */
  async function get(area) { return store.read(area, name, null); }
  /** Validates and stores a picture, skipping the write when its content is unchanged. */
  async function present(area, input, presenter) {
    const validation = validateAreaPicture(area, input); if (!validation.ok) return { status: 422, errors: validation.errors };
    const previous = await get(area); const content = { ...input, schema: "area-picture.v1", area, presenter };
    const contentHash = hash(content);
    if (previous?.contentHash === contentHash) return { status: 200, picture: previous, idempotent: true };
    const picture = { ...content, version: (previous?.version ?? 0) + 1, presentedAt: now(), contentHash };
    await store.write(area, name, picture); return { status: 200, picture, idempotent: false };
  }
  /** Removes an Area's picture, fenced by its content hash when one is given. */
  async function withdraw(area, contentHash) {
    const current = await get(area);
    if (!current) return { status: 404, error: "picture was not found" };
    if (contentHash && current.contentHash !== contentHash) return { status: 409, error: "picture changed", picture: current };
    await store.write(area, name, null);
    return { status: 200, withdrawn: true };
  }
  return { get, present, withdraw };
}
