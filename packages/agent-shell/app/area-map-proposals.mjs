import { createHash, randomUUID } from "node:crypto";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (kind, source) => `${kind}:${source.file ?? source.url}:${source.subpath ?? ""}`;
export function createAreaMapProposals({ store, now = () => new Date().toISOString(), id = randomUUID }) {
  const name = "map-proposals.json";
  async function record(area) { return store.read(area, name, { schema: "area-map-proposals.v1", area, proposals: [] }); }
  async function list(area, { openOnly = false } = {}) { const current = await record(area); return openOnly ? current.proposals.filter((proposal) => proposal.state === "open") : current.proposals; }
  async function propose(area, input, presenter) {
    if (!input || !["file", "link"].includes(input.kind) || !input.source || typeof input.note !== "string" || input.note.length > 300) return { status: 422, error: "proposal is invalid" };
    const current = await record(area); const key = identity(input.kind, input.source); const existing = current.proposals.find((proposal) => proposal.identity === key);
    const contentHash = digest({ kind: input.kind, source: input.source, note: input.note });
    if (existing?.contentHash === contentHash && existing.state === "open") return { status: 200, proposal: existing, idempotent: true };
    const proposal = { id: existing?.id ?? id(), identity: key, area, version: (existing?.version ?? 0) + 1, kind: input.kind, source: input.source, note: input.note, proposedAt: now(), presenter, contentHash, state: "open" };
    if (existing) current.proposals[current.proposals.indexOf(existing)] = proposal; else current.proposals.push(proposal);
    await store.write(area, name, current); return { status: 200, proposal, idempotent: false };
  }
  async function decide(area, proposalId, version, state) {
    if (!["dismissed", "placed"].includes(state)) return { status: 422, error: "proposal decision is invalid" };
    const current = await record(area); const proposal = current.proposals.find((item) => item.id === proposalId);
    if (!proposal) return { status: 404, error: "proposal was not found" };
    if (proposal.version !== version) return { status: 409, error: "proposal changed", proposal };
    proposal.state = state; proposal.version += 1; await store.write(area, name, current); return { status: 200, proposal };
  }
  return { decide, list, propose, record };
}
