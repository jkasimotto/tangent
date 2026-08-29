import { createHash, randomUUID } from "node:crypto";
/** Hashes proposal content for idempotent updates. */
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Builds the stable identity of one proposed source. */
const identity = (kind, source) => `${kind}:${source.file ?? source.url}:${source.subpath ?? ""}`;
/** Creates the exact-brain proposal store for one Area map. */
export function createAreaMapProposals({ store, now = () => new Date().toISOString(), id = randomUUID }) {
  const name = "map-proposals.json";
  /** Reads one Area's proposal record. */
  async function record(area) { return store.read(area, name, { schema: "area-map-proposals.v1", area, proposals: [] }); }
  /** Lists all proposals or only proposals that Julian can place. */
  async function list(area, { openOnly = false } = {}) { const current = await record(area); return openOnly ? current.proposals.filter((proposal) => proposal.state === "open") : current.proposals; }
  /** Creates or updates one source-identified proposal. */
  async function propose(area, input, presenter) {
    if (!input || !["file", "link"].includes(input.kind) || !input.source || typeof input.note !== "string" || input.note.length > 300) return { status: 422, error: "proposal is invalid" };
    if (input.kind === "file" && (typeof input.source.file !== "string" || !input.source.file.endsWith(".md") || input.source.file.startsWith("/") || input.source.file.includes("\\") || input.source.file.split("/").includes("..") || input.source.subpath !== undefined && !String(input.source.subpath).startsWith("#"))) return { status: 422, error: "proposal source is invalid" };
    if (input.kind === "link" && (typeof input.source.url !== "string" || !/^https?:\/\//.test(input.source.url))) return { status: 422, error: "proposal link is invalid" };
    const current = await record(area); const key = identity(input.kind, input.source); const existing = current.proposals.find((proposal) => proposal.identity === key);
    const contentHash = digest({ kind: input.kind, source: input.source, note: input.note });
    if (existing?.contentHash === contentHash && existing.state === "open") return { status: 200, proposal: existing, idempotent: true };
    const proposal = { id: existing?.id ?? id(), identity: key, area, version: (existing?.version ?? 0) + 1, kind: input.kind, source: input.source, note: input.note, proposedAt: now(), presenter, contentHash, state: "open" };
    if (existing) current.proposals[current.proposals.indexOf(existing)] = proposal; else current.proposals.push(proposal);
    await store.write(area, name, current); return { status: 200, proposal, idempotent: false };
  }
  /** Records Julian's version-fenced proposal decision. */
  async function decide(area, proposalId, version, state) {
    if (!["dismissed", "placed"].includes(state)) return { status: 422, error: "proposal decision is invalid" };
    const current = await record(area); const proposal = current.proposals.find((item) => item.id === proposalId);
    if (!proposal) return { status: 404, error: "proposal was not found" };
    if (proposal.version !== version) return { status: 409, error: "proposal changed", proposal };
    proposal.state = state; proposal.version += 1; await store.write(area, name, current); return { status: 200, proposal };
  }
  /** Lets the exact brain withdraw the current proposal version. */
  async function withdraw(area, proposalId, version) {
    const current = await record(area); const proposal = current.proposals.find((item) => item.id === proposalId);
    if (!proposal) return { status: 404, error: "proposal was not found" };
    if (proposal.version !== version) return { status: 409, error: "proposal changed", proposal };
    proposal.state = "withdrawn"; proposal.version += 1; await store.write(area, name, current); return { status: 200, proposal };
  }
  return { decide, list, propose, record, withdraw };
}
