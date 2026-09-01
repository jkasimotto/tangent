import { appendFile } from "node:fs/promises";
import { deliveryDecision, messageBanner } from "./agent-messages.mjs";
import { mapWithConcurrency } from "./bounded-work.mjs";

/** Owns cross-agent queues, delivery policy, and their audit log. */
export function createMessageDelivery({ file, sessions, deliverText, notices, wake, store = null, onFailure = null, now = () => new Date().toISOString(), report = console.error, maxPerTarget = 100, maxTotal = 1_000, concurrency = 8 }) {
  const queues = new Map();
  const deliveringTargets = new Set();
  let activeDeliveries = 0;
  let ticking = null;
  let durableMutations = Promise.resolve();
  const failedThisProcess = new Set();

  // Generic `tangent send` entries and brain notices live in this store
  // until they were shown (D24). Context reminders carry a live render
  // function that must not be guessed back from JSON, so they stay in memory.
  for (const stored of store?.entries?.() ?? []) {
    const pending = queues.get(stored.target) ?? [];
    pending.push({
      deliveryId: stored.id,
      durable: true,
      from: stored.from,
      area: stored.area,
      text: stored.text,
      banner: stored.banner,
      queuedAt: stored.queuedAt,
      sourceRole: stored.sourceRole ?? null,
      deliveryState: stored.deliveryState ?? "accepted",
      targetIdentity: stored.targetIdentity ?? null,
      ...(stored.notices?.length ? { notices: stored.notices, generation: stored.generation ?? null, brainArea: stored.brainArea ?? null } : {}),
    });
    queues.set(stored.target, pending);
  }

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
    const targetName = typeof target === "string" ? target : target.name;
    const body = typeof entry.render === "function" ? entry.render() ?? entry.text : entry.text;
    const text = entry.banner === false ? body : messageBanner(entry.from, entry.area, body);
    /** Makes each transport checkpoint durable before its next tmux action. */
    const checkpoint = async (deliveryState) => {
      entry.deliveryState = deliveryState;
      if (entry.durable && store?.update) await store.update(entry.deliveryId, { deliveryState });
    };
    const arrived = await deliverText(entry.targetIdentity ?? target, text, entry.banner === false ? "pipeline step" : "agent message", {
      settle: composer !== "working" && composer !== "draft",
      composer,
      deliveryId: entry.deliveryId ?? null,
      deliveryState: entry.deliveryState ?? "accepted",
      checkpoint,
    });
    await log({ event: arrived ? "delivered" : "not delivered", deliveryId: entry.deliveryId ?? null, deliveryState: entry.deliveryState ?? "accepted", to: targetName, from: entry.from, area: entry.area, text: body, banner: entry.banner !== false, queuedAt: entry.queuedAt });
    // A notice that did not arrive stays queued and unread; the inbox marks
    // it read only after it was shown.
    if (arrived && entry.notices?.length) await notices.delivered(entry.notices, targetName, entry.generation ?? null, entry.brainArea ?? null);
    return arrived;
  }

  /** Reports one terminal attempt once while preserving its durable record. */
  async function fail(target, entry, error) {
    const targetName = typeof target === "string" ? target : target?.name;
    failedThisProcess.add(entry.deliveryId ?? entry);
    entry.deliveryState = error?.deliveryState ?? entry.deliveryState ?? "failed";
    if (entry.durable && store?.update) await store.update(entry.deliveryId, { deliveryState: entry.deliveryState });
    const detail = String(error?.message ?? error);
    await log({ event: "delivery failed", deliveryId: entry.deliveryId ?? null, deliveryState: entry.deliveryState, to: targetName, from: entry.from, area: entry.area, text: entry.text, reason: detail });
    report("agent message:", detail);
    if (onFailure) await onFailure({ target: targetName, entry, error }).catch((failure) => report("agent message failure notice:", failure?.message ?? failure));
  }

  /** Adds one entry behind existing work for a target. */
  function queue(target, entry) {
    const pending = queues.get(target) ?? [];
    if (pending.length >= maxPerTarget || totalQueued() >= maxTotal) {
      const reason = pending.length >= maxPerTarget ? `target queue limit ${maxPerTarget}` : `message queue limit ${maxTotal}`;
      void log({ event: "rejected", to: target, from: entry.from, text: entry.text, reason });
      report("agent message queue:", `${target}: ${reason}`);
      return 0;
    }
    pending.push(entry);
    queues.set(target, pending);
    wake();
    return pending.length;
  }

  /** Persists one generic message before exposing it to delivery polling. */
  function queueDurably(target, entry) {
    const targetName = typeof target === "string" ? target : target.name;
    const operation = durableMutations.then(async () => {
      const pending = queues.get(targetName) ?? [];
      const waiting = queuedCount(targetName);
      if (waiting >= maxPerTarget || totalQueued() >= maxTotal) {
        const reason = waiting >= maxPerTarget ? `target queue limit ${maxPerTarget}` : `message queue limit ${maxTotal}`;
        await log({ event: "rejected", to: target, from: entry.from, text: entry.text, reason });
        report("agent message queue:", `${target}: ${reason}`);
        return { position: 0, reason };
      }
      if (!store?.append) throw new Error("durable agent-message storage is unavailable");
      const stored = await store.append(targetName, {
        ...entry,
        deliveryState: entry.deliveryState ?? "accepted",
        targetIdentity: entry.targetIdentity ?? (typeof target === "object" ? target : null),
      });
      const durable = {
        ...entry,
        durable: true,
        deliveryId: stored.id,
        queuedAt: stored.queuedAt,
      };
      pending.push(durable);
      queues.set(targetName, pending);
      return { position: queuedCount(targetName), entry: durable };
    });
    durableMutations = operation.catch(() => {});
    return operation;
  }

  /**
   * Queues one brain notice durably behind existing work for a target, then
   * wakes delivery. Returns the queue position, 0 when the queue refused it;
   * a refused notice stays unread in its inbox for the next sweep.
   */
  async function queueDurable(target, entry) {
    const queued = await queueDurably(target, { ...entry, durable: true });
    wake();
    return queued.position;
  }

  /** The inbox notices every queued entry still carries, as `area id` keys. */
  function pendingNotices() {
    const keys = new Set();
    for (const pending of queues.values()) {
      for (const entry of pending) for (const notice of entry.notices ?? []) keys.add(`${notice.area} ${notice.id}`);
    }
    return keys;
  }

  /** Removes one settled head from disk first, then from the live queue. */
  async function settle(target, pending, entry) {
    if (entry.durable) await store.remove(entry.deliveryId);
    const index = pending.indexOf(entry);
    if (index >= 0) pending.splice(index, 1);
    if (!pending.length) queues.delete(target);
  }

  /** Delivers immediately when safe and ordered, otherwise queues. */
  async function dispatch(target, entry) {
    const decision = deliveryDecision(target ?? null);
    if (decision.action === "refuse") return { status: target ? 409 : 404, error: decision.error };
    if (entry.durable) {
      const queued = await queueDurably(target, { ...entry, targetIdentity: entry.targetIdentity ?? target });
      if (!queued.position) return { status: 429, error: "agent message queue is full; retry after queued messages are delivered" };
      const pending = queues.get(target.name);
      if (decision.action === "deliver" && !ticking && pending?.[0] === queued.entry && !deliveringTargets.has(target.name) && activeDeliveries < concurrency) {
        deliveringTargets.add(target.name);
        activeDeliveries += 1;
        try {
          const arrived = await deliver(target, queued.entry, decision.composer);
          if (arrived) {
            await settle(target.name, pending, queued.entry);
            failedThisProcess.delete(queued.entry.deliveryId);
            await log({ event: "sent", to: target.name, from: entry.from, text: entry.text, disposition: "delivered" });
            return { status: 200, state: "delivered", to: target.name, receipt: queued.entry.deliveryId };
          }
          const reason = "the exact target was not ready at the final composer check; the durable message will retry";
          return { status: 200, state: "queued", to: target.name, reason, position: queued.position, receipt: queued.entry.deliveryId };
        } catch (error) {
          await fail(target, queued.entry, error);
          return { status: 409, error: String(error?.message ?? error), receipt: queued.entry.deliveryId };
        } finally {
          activeDeliveries -= 1;
          deliveringTargets.delete(target.name);
          wake();
        }
      }
      const reason = decision.action === "queue" ? decision.reason : "messages queued ahead";
      await log({ event: "sent", to: target.name, from: entry.from, text: entry.text, disposition: "queued", reason });
      wake();
      return { status: 200, state: "queued", to: target.name, reason, position: queued.position };
    }
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
      await durableMutations;
      if (!queues.size) return;
      const liveSessions = await sessions();
      const liveByName = new Map(liveSessions.map((session) => [session.name, session]));
      const capacity = Math.max(0, concurrency - activeDeliveries);
      if (!capacity) return;
      await mapWithConcurrency([...queues.entries()], capacity, async ([target, pending]) => {
        if (deliveringTargets.has(target)) return;
        const live = liveByName.get(target);
        if (!live) {
          // A dropped brain notice is still unread in its inbox; the sweep
          // queues it again for the next live generation.
          for (const entry of pending) await log({ event: "dropped", to: target, from: entry.from, text: entry.text, reason: "session ended" });
          const releasable = pending.filter((entry) => !entry.durable || entry.notices?.length);
          const durableIds = releasable.filter((entry) => entry.durable).map((entry) => entry.deliveryId);
          if (durableIds.length) await store.remove(durableIds);
          for (const entry of pending.filter((item) => item.durable && !item.notices?.length)) {
            const error = Object.assign(new Error(`Message ${entry.deliveryId} was not submitted to ${target}: the exact tmux session ended. Start the intended worker again, then resend the message.`), { deliveryState: "failed" });
            await fail(target, entry, error);
          }
          const kept = pending.filter((entry) => entry.durable && !entry.notices?.length);
          if (kept.length) queues.set(target, kept);
          else queues.delete(target);
          return;
        }
        const brainEntry = pending[0]?.notices?.length ? pending[0] : null;
        if (brainEntry?.brainArea && (brainEntry.brainArea !== live.area || Number(brainEntry.generation) !== Number(live.generation))) {
          await log({ event: "route fenced", sourceArea: brainEntry.notices[0]?.area ?? null, brainArea: brainEntry.brainArea ?? null, to: target, from: brainEntry.from, text: brainEntry.text, reason: "brain route identity changed before delivery" });
          if (brainEntry.durable) await store.remove(brainEntry.deliveryId);
          pending.shift();
          if (!pending.length) queues.delete(target);
          return;
        }
        const entry = pending[0];
        if (failedThisProcess.has(entry.deliveryId ?? entry)) return;
        const decision = deliveryDecision(live);
        const recovery = entry.durable && entry.deliveryState && entry.deliveryState !== "accepted";
        if (decision.action !== "deliver" && !recovery) return;
        deliveringTargets.add(target);
        activeDeliveries += 1;
        try {
          const arrived = await deliver(live, entry, recovery ? (live.composer ?? decision.composer) : decision.composer);
          // A durable entry keeps its head until the prompt transport proves
          // the whole presentation arrived; a memory entry is tried once.
          if (arrived || !entry.durable) {
            await settle(target, pending, entry);
            failedThisProcess.delete(entry.deliveryId ?? entry);
          }
        } catch (error) {
          await fail(live, entry, error);
        } finally {
          activeDeliveries -= 1;
          deliveringTargets.delete(target);
        }
      });
    })().finally(() => { ticking = null; });
    return ticking;
  }

  /** Moves pending messages after a worker changes session names. */
  function retarget(oldName, newName) {
    const pending = queues.get(oldName);
    if (!pending) return;
    queues.delete(oldName);
    const kept = pending;
    if (kept.length) {
      const merged = [...(queues.get(newName) ?? []), ...kept];
      const accepted = merged.slice(0, maxPerTarget);
      const rejected = merged.slice(maxPerTarget);
      if (accepted.length) queues.set(newName, accepted);
      for (const entry of rejected) {
        void log({ event: "rejected", to: newName, from: entry.from, text: entry.text, reason: `target queue limit ${maxPerTarget} after retarget` });
      }
      const orderedIds = accepted.filter((entry) => entry.durable).map((entry) => entry.deliveryId);
      const rejectedIds = rejected.filter((entry) => entry.durable).map((entry) => entry.deliveryId);
      if (orderedIds.length || rejectedIds.length) {
        const persisted = durableMutations.then(() => store.retarget(oldName, newName, orderedIds, rejectedIds));
        durableMutations = persisted.catch((error) => report("agent message store:", error?.message ?? error));
        void persisted.then(wake).catch(() => {});
        return persisted;
      }
    }
  }

  /** Reports one target's queue depth without exposing queue storage. */
  function queuedCount(target) {
    const name = typeof target === "string" ? target : target?.name;
    const count = (queues.get(name) ?? []).length;
    return Math.max(0, count - (deliveringTargets.has(name) ? 1 : 0));
  }

  /** Reports total queued entries across all targets. */
  function totalQueued() {
    let count = 0;
    for (const [target, pending] of queues) count += Math.max(0, pending.length - (deliveringTargets.has(target) ? 1 : 0));
    return count;
  }

  /** Reports whether delivery polling has work to do. */
  function active() {
    for (const pending of queues.values()) {
      if (pending.some((entry) => !failedThisProcess.has(entry.deliveryId ?? entry))) return true;
    }
    return false;
  }

  return { active, deliver, dispatch, log, pendingNotices, queue, queueDurable, queuedCount, retarget, tick, totalQueued };
}
