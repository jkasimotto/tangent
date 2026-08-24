import { appendFile } from "node:fs/promises";
import { deliveryDecision, messageBanner } from "./agent-messages.mjs";

/** Owns transient cross-agent queues, delivery policy, and their audit log. */
export function createMessageDelivery({ file, sessions, deliverText, notices, wake, now = () => new Date().toISOString(), report = console.error }) {
  const queues = new Map();

  /** Appends one delivery fact without making logging a workflow failure. */
  async function log(entry) {
    try {
      await appendFile(file, JSON.stringify({ at: now(), ...entry }) + "\n");
    } catch (error) {
      report("agent message log:", error?.message ?? error);
    }
  }

  /** Delivers one queued entry and settles any durable brain notices. */
  async function deliver(target, entry) {
    const body = typeof entry.render === "function" ? entry.render() ?? entry.text : entry.text;
    const text = entry.banner === false ? body : messageBanner(entry.from, entry.area, body);
    const arrived = await deliverText(target, text, entry.banner === false ? "pipeline step" : "agent message");
    await log({ event: arrived ? "delivered" : "not delivered", to: target, from: entry.from, area: entry.area, text: body, banner: entry.banner !== false, queuedAt: entry.queuedAt });
    if (!entry.notices?.length) return arrived;
    if (arrived) await notices.delivered(entry.notices, target, entry.generation ?? null);
    else notices.released(entry.notices);
    return arrived;
  }

  /** Adds one entry behind existing work for a target. */
  function queue(target, entry) {
    const pending = queues.get(target) ?? [];
    pending.push(entry);
    queues.set(target, pending);
    wake();
    return pending.length;
  }

  /** Delivers immediately when safe and ordered, otherwise queues. */
  async function dispatch(target, entry) {
    const decision = deliveryDecision(target ?? null);
    if (decision.action === "refuse") return { status: target ? 409 : 404, error: decision.error };
    if (decision.action === "deliver" && queuedCount(target.name) === 0) {
      void deliver(target.name, entry).catch((error) => report("agent message:", error?.message ?? error));
      await log({ event: "sent", to: target.name, from: entry.from, text: entry.text, disposition: "delivered" });
      return { status: 200, state: "delivered", to: target.name };
    }
    const position = queue(target.name, entry);
    const reason = decision.action === "queue" ? decision.reason : "messages queued ahead";
    await log({ event: "sent", to: target.name, from: entry.from, text: entry.text, disposition: "queued", reason });
    return { status: 200, state: "queued", to: target.name, reason, position };
  }

  /** Delivers all queue heads whose target is ready and drops dead targets. */
  async function tick() {
    if (!queues.size) return;
    const liveSessions = await sessions();
    for (const [target, pending] of [...queues.entries()]) {
      const live = liveSessions.find((session) => session.name === target);
      if (!live) {
        queues.delete(target);
        for (const entry of pending) {
          await log({ event: "dropped", to: target, from: entry.from, text: entry.text, reason: "session ended" });
          if (entry.notices?.length) notices.released(entry.notices);
        }
        continue;
      }
      if (deliveryDecision(live).action !== "deliver") continue;
      const entry = pending.shift();
      if (!pending.length) queues.delete(target);
      await deliver(target, entry);
    }
  }

  /** Moves non-reminder messages after a worker changes session names. */
  function retarget(oldName, newName) {
    const pending = queues.get(oldName);
    if (!pending) return;
    queues.delete(oldName);
    const kept = pending.filter((entry) => entry.kind !== "context-reminder");
    if (kept.length) queues.set(newName, [...(queues.get(newName) ?? []), ...kept]);
  }

  /** Reports one target's queue depth without exposing queue storage. */
  function queuedCount(target) {
    return (queues.get(typeof target === "string" ? target : target?.name) ?? []).length;
  }

  /** Reports whether delivery polling has work to do. */
  function active() {
    return queues.size > 0;
  }

  return { active, deliver, dispatch, log, queue, queuedCount, retarget, tick };
}
