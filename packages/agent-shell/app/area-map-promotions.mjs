import { randomUUID } from "node:crypto";
const STATES = ["requested", "waiting-for-brain", "durable-created", "canvas-replaced", "complete", "failed"];
/** Creates the resumable runtime record for map-to-vault promotions. */
export function createAreaMapPromotions({ store, now = () => new Date().toISOString(), id = randomUUID }) {
  const name = "map-promotions.json";
  /** Reads one Area's promotion record. */
  async function record(area) { return store.read(area, name, { schema: "area-map-promotions.v1", area, promotions: [] }); }
  /** Starts one idempotent promotion operation. */
  async function start(area, input) {
    const current = await record(area); const existing = current.promotions.find((item) => item.id === input.id);
    if (existing) return { status: 200, promotion: existing, idempotent: true };
    if (!input || !["goal", "document", "subarea", "relation"].includes(input.kind) || !input.sourceCanvasHash) return { status: 422, error: "promotion is invalid" };
    const stamp = now(); const promotion = { id: input.id || id(), area, kind: input.kind, sourceCanvasHash: input.sourceCanvasHash, nodeId: input.nodeId ?? null, edgeId: input.edgeId ?? null, state: "requested", durableRef: null, brainNoticeId: null, createdAt: stamp, updatedAt: stamp, error: null };
    current.promotions.push(promotion); await store.write(area, name, current); return { status: 200, promotion, idempotent: false };
  }
  /** Advances one promotion through an expected state transition. */
  async function advance(area, promotionId, from, to, patch = {}) {
    if (!STATES.includes(to)) return { status: 422, error: "promotion state is invalid" };
    const current = await record(area); const promotion = current.promotions.find((item) => item.id === promotionId);
    if (!promotion) return { status: 404, error: "promotion was not found" };
    if (promotion.state === to) return { status: 200, promotion, idempotent: true };
    if (promotion.state !== from || STATES.indexOf(to) < STATES.indexOf(from) && to !== "failed") return { status: 409, error: "promotion state changed", promotion };
    Object.assign(promotion, patch, { state: to, updatedAt: now() }); await store.write(area, name, current); return { status: 200, promotion };
  }
  /** Attaches the brain-created durable reference without claiming the canvas replacement is finished. */
  async function complete(area, promotionId, durableRef, brainNoticeId = null) {
    if (!durableRef || typeof durableRef.file !== "string" || !durableRef.file.trim() || durableRef.file.startsWith("/") || durableRef.file.split("/").includes("..") || durableRef.subpath !== undefined && !String(durableRef.subpath).startsWith("#")) {
      return { status: 422, error: "durable reference is invalid" };
    }
    const current = await record(area); const promotion = current.promotions.find((item) => item.id === promotionId);
    if (!promotion) return { status: 404, error: "promotion was not found" };
    if (promotion.durableRef) return JSON.stringify(promotion.durableRef) === JSON.stringify(durableRef)
      ? { status: 200, promotion, idempotent: true }
      : { status: 409, error: "promotion already has a different durable reference", promotion };
    if (!["requested", "waiting-for-brain"].includes(promotion.state)) return { status: 409, error: "promotion state changed", promotion };
    Object.assign(promotion, { durableRef, brainNoticeId, state: "durable-created", updatedAt: now(), error: null });
    await store.write(area, name, current); return { status: 200, promotion, idempotent: false };
  }
  /** Lists promotion operations that still need work. */
  async function incomplete(area) { return (await record(area)).promotions.filter((item) => !["complete", "failed"].includes(item.state)); }
  return { advance, complete, incomplete, record, start };
}
