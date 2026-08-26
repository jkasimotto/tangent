import { appendFile } from "node:fs/promises";
import { deliveryDecision, messageBanner } from "./agent-messages.mjs";
import { mapWithConcurrency } from "./bounded-work.mjs";

/** Owns transient cross-agent queues, delivery policy, and their audit log. */
export function createMessageDelivery({ file, sessions, deliverText, notices, wake, now = () => new Date().toISOString(), report = console.error, maxPerTarget = 100, maxTotal = 1_000, concurrency = 8 }) {
  const queues = new Map();
  const deliveringTargets = new Set();
  let activeDeliveries = 0;
  let ticking = null;

  /** Appends one delivery fact without making logging a workflow failure. */
  async function log(entry) {
    try {
      await appendFile(file, JSON.stringify({ at: now(), ...entry }) + "\n");
    } catch (error) {
      report("agent message log:", error?.message ?? error);
    }
  }

  /**
   * Delivers one queued entry and settles any durable brain notices.
   * `composer` is the decision's finding: into a working agent's empty
   * composer the transport must type at once, because a repainting screen
   * never goes quiet and the harness needs no boot wait.
   */
  async function deliver(target, entry, composer = "idle") {
    const body = typeof entry.render === "function" ? entry.render() ?? entry.text : entry.text;
    const text = entry.banner === false ? body : messageBanner(entry.from, entry.area, body);
    const arrived = await deliverText(target, text, entry.banner === false ? "pipeline step" : "agent message", { settle: composer !== "working" });
    await log({ event: arrived ? "delivered" : "not delivered", to: target, from: entry.from, area: entry.area, text: body, banner: entry.banner !== false, queuedAt: entry.queuedAt });
    if (!entry.notices?.length) return arrived;
    if (arrived) await notices.delivered(entry.notices, target, entry.generation ?? null);
    else notices.released(entry.notices);
    return arrived;
  }

  /** Adds one entry behind existing work for a target. */
  function queue(target, entry) {
    const pending = queues.get(target) ?? [];
    if (pending.length >= maxPerTarget || totalQueued() >= maxTotal) {
      const reason = pending.length >= maxPerTarget ? `target queue limit ${maxPerTarget}` : `message queue limit ${maxTotal}`;
      void log({ event: "rejected", to: target, from: entry.from, text: entry.text, reason });
      if (entry.notices?.length) notices.released(entry.notices);
      report("agent message queue:", `${target}: ${reason}`);
      return 0;
    }
    pending.push(entry);
    queues.set(target, pending);
    wake();
    return pending.length;
  }

  /** Delivers immediately when safe and ordered, otherwise queues. */
  async function dispatch(target, entry) {
    const decision = deliveryDecision(target ?? null);
    if (decision.action === "refuse") return { status: target ? 409 : 404, error: decision.error };
    if (decision.action === "deliver" && !ticking && queuedCount(target.name) === 0 && !deliveringTargets.has(target.name) && activeDeliveries < concurrency) {
      deliveringTargets.add(target.name);
      activeDeliveries += 1;
      void deliver(target.name, entry, decision.composer)
        .catch((error) => report("agent message:", error?.message ?? error))
        .finally(() => {
          activeDeliveries -= 1;
          deliveringTargets.delete(target.name);
          wake();
        });
      await log({ event: "sent", to: target.name, from: entry.from, text: entry.text, disposition: "delivered" });
      return { status: 200, state: "delivered", to: target.name };
    }
    const position = queue(target.name, entry);
    if (!position) return { status: 429, error: "agent message queue is full; retry after queued messages are delivered" };
    const reason = decision.action === "queue" ? decision.reason : "messages queued ahead";
    await log({ event: "sent", to: target.name, from: entry.from, text: entry.text, disposition: "queued", reason });
    return { status: 200, state: "queued", to: target.name, reason, position };
  }

  /** Delivers all queue heads whose target is ready and drops dead targets. */
  async function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      if (!queues.size) return;
      const liveSessions = await sessions();
      const liveByName = new Map(liveSessions.map((session) => [session.name, session]));
      const capacity = Math.max(0, concurrency - activeDeliveries);
      if (!capacity) return;
      await mapWithConcurrency([...queues.entries()], capacity, async ([target, pending]) => {
        if (deliveringTargets.has(target)) return;
        const live = liveByName.get(target);
        if (!live) {
          queues.delete(target);
          for (const entry of pending) {
            await log({ event: "dropped", to: target, from: entry.from, text: entry.text, reason: "session ended" });
            if (entry.notices?.length) notices.released(entry.notices);
          }
          return;
        }
        const decision = deliveryDecision(live);
        if (decision.action !== "deliver") return;
        const entry = pending.shift();
        if (!pending.length) queues.delete(target);
        deliveringTargets.add(target);
        activeDeliveries += 1;
        try {
          await deliver(target, entry, decision.composer);
        } finally {
          activeDeliveries -= 1;
          deliveringTargets.delete(target);
        }
      });
    })().finally(() => { ticking = null; });
    return ticking;
  }

  /** Moves non-reminder messages after a worker changes session names. */
  function retarget(oldName, newName) {
    const pending = queues.get(oldName);
    if (!pending) return;
    queues.delete(oldName);
    const kept = pending.filter((entry) => entry.kind !== "context-reminder");
    if (kept.length) {
      const merged = [...(queues.get(newName) ?? []), ...kept];
      const accepted = merged.slice(0, maxPerTarget);
      const rejected = merged.slice(maxPerTarget);
      if (accepted.length) queues.set(newName, accepted);
      for (const entry of rejected) {
        void log({ event: "rejected", to: newName, from: entry.from, text: entry.text, reason: `target queue limit ${maxPerTarget} after retarget` });
        if (entry.notices?.length) notices.released(entry.notices);
      }
    }
  }

  /** Reports one target's queue depth without exposing queue storage. */
  function queuedCount(target) {
    return (queues.get(typeof target === "string" ? target : target?.name) ?? []).length;
  }

  /** Reports total queued entries across all targets. */
  function totalQueued() {
    let count = 0;
    for (const pending of queues.values()) count += pending.length;
    return count;
  }

  /** Reports whether delivery polling has work to do. */
  function active() {
    return queues.size > 0;
  }

  return { active, deliver, dispatch, log, queue, queuedCount, retarget, tick, totalQueued };
}
