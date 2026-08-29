import assert from "node:assert/strict"; import test from "node:test"; import { createAreaMapProposals } from "./area-map-proposals.mjs";
/** Creates one in-memory runtime-record store. */
const memory = () => { let value; return {
  /** Reads the current test record or its fallback. */
  async read(_a, _n, fallback) { return value ?? structuredClone(fallback); },
  /** Replaces the current test record. */
  async write(_a, _n, next) { value = structuredClone(next); },
}; };
/** Returns a stable proposal ID for version tests. */
const proposalId = () => "p";
test("keeps identity, versions updates, and fences stale decisions", async () => { const proposals = createAreaMapProposals({ store: memory(), id: proposalId }); const first = await proposals.propose("otto", { kind: "file", source: { file: "otto/a.md" }, note: "A" }, {}); const second = await proposals.propose("otto", { kind: "file", source: { file: "otto/a.md" }, note: "B" }, {}); assert.equal(second.proposal.id, first.proposal.id); assert.equal(second.proposal.version, 2); assert.equal((await proposals.decide("otto", "p", 1, "dismissed")).status, 409); });
test("only the current proposal version can be withdrawn", async () => { const proposals = createAreaMapProposals({ store: memory(), id: proposalId }); const created = await proposals.propose("otto", { kind: "link", source: { url: "https://example.com" }, note: "Evidence" }, {}); assert.equal((await proposals.withdraw("otto", "p", 0)).status, 409); assert.equal((await proposals.withdraw("otto", "p", created.proposal.version)).proposal.state, "withdrawn"); });
test("rejects unsafe files and active-content links", async () => { const proposals = createAreaMapProposals({ store: memory() }); assert.equal((await proposals.propose("otto", { kind: "file", source: { file: "../secret.md" }, note: "" }, {})).status, 422); assert.equal((await proposals.propose("otto", { kind: "link", source: { url: "javascript:alert(1)" }, note: "" }, {})).status, 422); });
