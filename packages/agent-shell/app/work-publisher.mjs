import { randomUUID } from "node:crypto";
import { WORK_DOMAINS, workSemanticHash } from "./work-model.mjs";

/**
 * Coalesces source invalidations, rereads source authority, and keeps one
 * candidate in flight until the gateway acknowledges durable publication.
 */
export function createWorkPublisher({ adapters, controllerBoot, sendCandidate, sendDirty = () => {}, sendCurrent = () => {}, intervalMs = 30_000, burstMs = 25, forceMs = 100, now = Date.now, metric = () => {} }) {
  const dirty = new Map();
  const sequence = new Map(WORK_DOMAINS.map((domain) => [domain, 0]));
  let inFlight = null;
  let scheduled = null;
  let burstStartedAt = 0;
  let interval = null;
  let stopped = true;
  let lastSentHash = null;
  let rejectedHash = null;
  let rejectedWatermark = null;
  let reconciled = false;

  /** Records a hint only. The source read supplies the later fact. */
  function invalidate(domain, entityId = "*", { operationId = null, changedAt = new Date(now()).toISOString() } = {}) {
    if (!WORK_DOMAINS.includes(domain)) throw new Error(`unknown Work source domain ${domain}`);
    const next = sequence.get(domain) + 1;
    sequence.set(domain, next);
    dirty.set(`${domain}\0${entityId}`, { domain, entityId, sequence: next, operationId, changedAt });
    metric("work_invalidation_total", 1, { domain });
    metric("work_dirty_entities", dirty.size);
    sendDirty({ type: "work-dirty", domain, sequence: next, changedAt });
    schedule();
    return next;
  }

  /** Schedules one bounded coalesced publication. */
  function schedule() {
    if (stopped || scheduled || inFlight) return;
    const at = now();
    if (!burstStartedAt) burstStartedAt = at;
    const delay = Math.max(0, Math.min(burstMs, burstStartedAt + forceMs - at));
    scheduled = setTimeout(() => {
      scheduled = null;
      void publish();
    }, delay);
    scheduled.unref?.();
  }

  /** Builds from source facts covered by one captured dirty watermark. */
  async function publish({ full = false } = {}) {
    if (inFlight) return inFlight;
    const startedAt = now();
    const watermark = sourceWatermark();
    const dirtyAtWatermark = [...dirty.values()];
    const domains = full || !reconciled ? WORK_DOMAINS : [...new Set([...dirty.values()].map((entry) => entry.domain))];
    if (!domains.length) return null;
    inFlight = (async () => {
      try {
        const candidate = await adapters.reconcile(domains);
        reconciled = true;
        const semanticHash = workSemanticHash(candidate);
        const bytes = Buffer.byteLength(JSON.stringify(candidate));
        metric("work_candidate_build_ms", now() - startedAt);
        metric("work_candidate_bytes", bytes);
        for (const kind of ["areas", "goals", "agents", "brains", "processes", "problems"]) metric("work_candidate_rows", candidate[kind].length, { kind });
        if (semanticHash === rejectedHash && !hasSequenceAfter(rejectedWatermark)) {
          metric("work_reconcile_ms", now() - startedAt, { result: "suppressed" });
          return { state: "suppressed", semanticHash };
        }
        const message = { type: "work-candidate", candidateId: randomUUID(), controllerBoot, semanticHash, sourceWatermark: watermark, candidate };
        metric("work_unacknowledged_candidate", 1);
        const acknowledgement = await sendCandidate(message);
        metric("work_unacknowledged_candidate", 0);
        if (!acknowledgement?.ok) {
          rejectedHash = semanticHash;
          rejectedWatermark = watermark;
          clearCoveredDirty(watermark);
          metric("work_dirty_entities", dirty.size);
          metric("work_reconcile_ms", now() - startedAt, { result: "rejected" });
          return { state: "rejected", semanticHash, code: acknowledgement?.code ?? "candidate-rejected" };
        }
        rejectedHash = null;
        rejectedWatermark = null;
        lastSentHash = semanticHash;
        clearCoveredDirty(acknowledgement.sourceWatermark ?? watermark);
        metric("work_dirty_entities", dirty.size);
        for (const domain of domains) {
          const times = dirtyAtWatermark.filter((entry) => entry.domain === domain).map((entry) => Date.parse(entry.changedAt)).filter(Number.isFinite);
          if (times.length) metric("work_source_to_publish_ms", Math.max(0, now() - Math.min(...times)), { domain });
        }
        metric("work_reconcile_ms", now() - startedAt, { result: acknowledgement.changed ? "changed" : "equal" });
        sendCurrent({ type: "work-current", sourceWatermark: acknowledgement.sourceWatermark ?? watermark, observedAt: new Date(now()).toISOString() });
        return { state: acknowledgement.changed ? "published" : "equal", semanticHash, acknowledgement };
      } finally {
        inFlight = null;
        burstStartedAt = 0;
        if (dirty.size) schedule();
      }
    })();
    return inFlight;
  }

  /** Starts initial and periodic authoritative reconciliation. */
  async function start() {
    if (!stopped) return;
    stopped = false;
    for (const domain of WORK_DOMAINS) invalidate(domain, "boot");
    await publish({ full: true });
    interval = setInterval(() => {
      for (const domain of WORK_DOMAINS) invalidate(domain, "reconcile");
    }, intervalMs);
    interval.unref?.();
  }

  /** Stops publication timers without changing durable facts. */
  function stop() {
    stopped = true;
    clearTimeout(scheduled);
    clearInterval(interval);
    scheduled = null;
    interval = null;
  }

  /** Returns the latest source sequence for each domain. */
  function sourceWatermark() { return Object.fromEntries(sequence); }
  /** Returns whether a source advanced beyond one watermark. */
  function hasSequenceAfter(watermark) { return !watermark || [...sequence].some(([domain, value]) => value > (watermark[domain] ?? 0)); }
  /** Clears dirty entries covered by an acknowledged watermark. */
  function clearCoveredDirty(watermark) { for (const [key, entry] of dirty) if (entry.sequence <= (watermark[entry.domain] ?? 0)) dirty.delete(key); }
  /** Returns bounded publisher health facts. */
  function status() { return { reconciled, dirty: dirty.size, inFlight: Boolean(inFlight), lastSentHash, rejectedHash, watermark: sourceWatermark() }; }

  return { invalidate, publish, start, stop, status };
}

/** Creates the controller side of the candidate acknowledgement protocol. */
export function createWorkCandidateChannel({ send = process.send?.bind(process), processTarget = process, timeoutMs = 10_000 } = {}) {
  const pending = new Map();
  /** Resolves only the exact candidate acknowledgement. */
  const onMessage = (message) => {
    if (!message || message.type !== "work-candidate-ack" || !pending.has(message.candidateId)) return;
    const waiter = pending.get(message.candidateId);
    pending.delete(message.candidateId);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  };
  processTarget.on?.("message", onMessage);

  /** Sends one candidate and waits for its exact acknowledgement. */
  function publish(message) {
    if (!send) return Promise.resolve({ ok: false, code: "gateway-channel-unavailable" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(message.candidateId);
        resolve({ ok: false, code: "candidate-ack-timeout" });
      }, timeoutMs);
      timer.unref?.();
      pending.set(message.candidateId, { resolve, timer });
      send(message, (error) => {
        if (!error) return;
        const waiter = pending.get(message.candidateId);
        if (!waiter) return;
        pending.delete(message.candidateId);
        clearTimeout(waiter.timer);
        waiter.resolve({ ok: false, code: "gateway-channel-error" });
      });
    });
  }

  /** Closes the channel and rejects every pending candidate. */
  function close() {
    processTarget.off?.("message", onMessage);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.resolve({ ok: false, code: "gateway-channel-closed" }); }
    pending.clear();
  }
  return { publish, close };
}
