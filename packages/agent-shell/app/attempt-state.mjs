const FINAL_ASSIGNMENT = new Set(["complete", "ended", "skipped"]);

/** Returns the latest durable worker report, or null. */
export function latestAttemptReport(assignment) {
  const report = [...(assignment?.reports ?? [])].reverse().find(Boolean) ?? assignment?.attempts?.at?.(-1)?.report ?? null;
  return report;
}

/** Converts a legacy pane row or a new observation into one observation. */
export function normalizeObservation(value, now = Date.now()) {
  if (!value) return null;
  if (value.observation) return value.observation;
  if (value.process && value.activity) return value;
  const at = Number(value.observedAt ?? value.at ?? now);
  const state = value.state ?? null;
  const detail = value.stateDetail ?? null;
  return {
    at,
    fresh: value.fresh !== false,
    harness: harnessOf(value.launchRef),
    process: state === "shell" ? "shell" : state ? "harness" : "other",
    activity: {
      lastOutputAt: state === "working" ? at : Number(value.lastOutputAt) || null,
      source: value.activitySource ?? (state === "working" ? "screen" : "none"),
    },
    composer: value.composer === "idle" || detail === "idle" ? "idle" : value.composer === "draft" || detail === "draft" ? "draft" : "none",
    dialog: detail === "decision" ? { question: value.stateQuestion ?? "", source: "screen" } : null,
    wall: value.wall ?? null,
    context: value.context ?? null,
    transcript: value.transcript ?? null,
  };
}

/** Derives the one server-authoritative word for a Goal attempt. */
export function deriveAttemptState({ assignment, observation: rawObservation, recovery = null, brain = null, repair = null, now = Date.now(), staleMs = 120_000, idleMs = 90_000, repairGraceMs = 180_000 } = {}) {
  const observation = normalizeObservation(rawObservation, now);
  const report = latestAttemptReport(assignment);
  if (report) return reportState(report, assignment, brain, repair, now, repairGraceMs);
  if (FINAL_ASSIGNMENT.has(assignment?.status)) {
    return state(title(assignment.status), timestamp(assignment?.endedAt, now), "none", "queue", `The assignment is ${assignment.status}.`, "No next action.");
  }
  const exhausted = [...(recovery ?? assignment?.attempts?.at?.(-1)?.recovery ?? [])].reverse().find((step) => step?.result === "failed" || step?.result === "expired");
  if (exhausted?.terminal === true) {
    return ownedState("Stuck", timestamp(exhausted.startedAt, now), brain, repair, now, repairGraceMs, "recovery", "Tangent used the repair ladder.", "The organizer decides the next action.");
  }
  if (!observation) {
    return ownedState(assignment?.status === "running" ? "Stopped" : "Open", timestamp(assignment?.startedAt, now), brain, repair, now, repairGraceMs, "runtime", "No live observation exists.", "The organizer repairs or restarts the attempt.");
  }
  if (now - observation.at >= staleMs) {
    const owner = now - observation.at >= 10 * 60_000 ? "you" : "tangent";
    return state("Unknown", timestamp(observation.at, now), owner, "observation", `The last observation is ${age(now - observation.at)} old.`, owner === "you" ? "Open the agent to inspect it." : "Tangent waits for a fresh observation.");
  }
  if (observation.process === "shell") {
    return ownedState("Stopped", timestamp(observation.at, now), brain, repair, now, repairGraceMs, "screen", "The harness exited to its shell.", "Tangent restarts it in place once.");
  }
  if (observation.dialog) {
    return state("Needs your decision", timestamp(observation.at, now), "you", "screen", observation.dialog.question || "The harness shows a decision dialog.", "Open the agent and answer the dialog.");
  }
  const outputAt = Number(observation.activity?.lastOutputAt) || Number(observation.transcript?.lastEventAt) || null;
  if (observation.wall && observation.activity?.source === "none" && (!outputAt || outputAt <= (observation.wall.since ?? observation.at))) {
    const suffix = observation.wall.model ? ` · ${observation.wall.model}` : "";
    const details = [observation.wall.text, observation.wall.harness, observation.wall.kind, observation.wall.source, new Date(observation.wall.since ?? observation.at).toISOString()].filter(Boolean).join(" · ");
    return ownedState(`Hit a wall${suffix}`, timestamp(observation.wall.since ?? observation.at, now), brain, repair, now, repairGraceMs, "screen", details || `The harness hit a ${observation.wall.kind} wall.`, "The organizer replaces or ends the attempt.");
  }
  if (outputAt && now - outputAt < idleMs) {
    return state("Working", timestamp(outputAt, now), "worker", observation.activity?.source === "transcript" || observation.transcript ? "transcript" : "screen", "The worker produced fresh output.", "The worker continues.");
  }
  if (observation.composer === "idle" && (!outputAt || now - outputAt >= idleMs)) {
    return state("Idle", timestamp(outputAt ?? observation.at, now), "tangent", observation.transcript ? "transcript" : "screen", "The worker stopped and sent no note.", "Tangent nudges it after 3 minutes.");
  }
  const unknownSince = timestamp(observation.at, now);
  const unknownOwner = now - unknownSince >= 10 * 60_000 ? "you" : "tangent";
  return state("Unknown", unknownSince, unknownOwner, "observation", "Tangent cannot classify the current pane.", unknownOwner === "you" ? "Open the agent to inspect it." : "Tangent waits for a clearer observation.");
}

/** Derives the one server-authoritative word for an Area brain. */
export function deriveBrainState({ brain, observation: rawObservation, unread = [], repair = null, now = Date.now() } = {}) {
  if (repair?.current && !repair.current.endedAt && Date.parse(repair.current.leaseUntil) > now) {
    const crew = deriveAttemptState({ assignment: { status: "running", startedAt: repair.current.startedAt }, observation: repair.current.observation, now });
    return { ...crew, word: `repair crew ${crew.word.toLowerCase()}`, owner: crew.owner === "worker" ? "repair crew" : crew.owner };
  }
  const observation = normalizeObservation(rawObservation, now);
  if (!brain || brain.status !== "active") return state("Brain stopped", timestamp(brain?.updatedAt, now), "none", "brain record", "The brain record is inactive.", unread.length ? `${unread.length} notes wait for repair.` : "Nothing needs Julian for the stopped brain itself.");
  if (brain.health?.status === "recovering" || brain.health?.status === "starting") return state("Brain recovering", timestamp(brain.health.updatedAt, now), "tangent", "brain record", brain.health.problem || "Tangent is recovering the brain.", "Tangent continues recovery.");
  if (brain.health?.status === "failed") return state("Brain has a problem", timestamp(brain.health.updatedAt, now), "repair crew", "brain record", brain.health.problem || "Automatic recovery failed.", "The repair crew handles waiting live work.");
  if (observation && now - observation.at >= 120_000) {
    const owner = now - observation.at >= 10 * 60_000 ? "you" : "tangent";
    return state("Brain unknown", timestamp(observation.at, now), owner, "observation", `The last brain observation is ${age(now - observation.at)} old.`, owner === "you" ? "Open the brain to inspect it." : "Tangent waits for a fresh observation.");
  }
  if (observation?.dialog) return state("Brain needs a decision", timestamp(observation.at, now), "you", "screen", observation.dialog.question || "The brain shows a decision dialog.", "Open the brain and answer it.");
  const outputAt = Number(observation?.activity?.lastOutputAt) || Number(observation?.transcript?.lastEventAt) || null;
  if (observation?.wall && observation.activity?.source === "none" && (!outputAt || outputAt <= (observation.wall.since ?? observation.at))) return state("Brain hit a wall", timestamp(observation.wall.since ?? observation.at, now), "repair crew", "screen", observation.wall.text, "The repair crew handles waiting live work.");
  if (observation?.process === "shell") return state("Brain has a problem", timestamp(observation.at, now), "tangent", "screen", "The brain harness exited to its shell.", "Tangent restarts it in place.");
  if (unread.length && observation?.composer !== "idle") {
    const since = timestamp(unread[0]?.createdAt, now);
    const owner = now - since >= 10 * 60_000 ? "you" : "brain";
    return state(`Brain has ${unread.length} notes`, since, owner, "queue", "The notes cannot enter the current composer.", owner === "you" ? "Open the brain and clear its composer." : "The brain reads the notes when its composer is clear.");
  }
  if (outputAt && now - outputAt < 90_000) return state("Brain working", timestamp(outputAt, now), "brain", observation?.transcript ? "transcript" : "screen", "The brain produced fresh output.", "The brain continues.");
  return state("Brain idle", timestamp(outputAt ?? observation?.at ?? brain.updatedAt, now), "brain", observation ? "screen" : "brain record", "Nothing waits for the brain.", "Entering the brain will not help.");
}

/** Derives one queue-backed state from the latest worker report. */
function reportState(report, assignment, brain, repair, now, repairGraceMs) {
  const type = report.type;
  const blocked = type === "failed" || report.status === "blocked" || report.status === "failed" || report.verdict === "blocked";
  const word = blocked ? "Reported blocked" : "Reported done";
  return ownedState(word, timestamp(report.reportedAt ?? assignment?.endedAt, now), brain, repair, now, repairGraceMs, "queue", report.summary ?? report.question ?? "The worker sent a report.", "The organizer reads the report and settles the Goal.");
}

/** Assigns an organizer-owned row without creating an early Julian blocker. */
function ownedState(word, since, brain, repair, now, repairGraceMs, source, evidence, next) {
  if (repair?.current && !repair.current.endedAt && Date.parse(repair.current.leaseUntil) > now) return state(word, since, "repair crew", source, evidence, next);
  const latestRepair = repair?.history?.at?.(-1) ?? null;
  if (latestRepair?.result === "blocked") return state(word, since, "you", source, latestRepair.report || evidence, "Restart the brain, or decide on the row.");
  const sameStopAttempts = latestRepair ? (repair.history ?? []).filter((item) => item.stop?.since === latestRepair.stop?.since).length : 0;
  if (sameStopAttempts >= 2 && ["failed", "expired"].includes(latestRepair?.result)) return state(word, since, "you", source, latestRepair.report || evidence, "Restart the brain, or decide on the row.");
  const stoppedSince = Date.parse(brain?.health?.updatedAt ?? brain?.updatedAt ?? 0);
  const live = brain?.status === "active" && brain?.live !== false && !["failed"].includes(brain?.health?.status);
  if (live) {
    const owner = now - since >= 10 * 60_000 ? "you" : "brain";
    return state(word, since, owner, source, evidence, owner === "you" ? "Open the organizer and settle this row." : next);
  }
  if (stoppedSince && now - stoppedSince >= repairGraceMs) return state(word, since, "repair crew", source, evidence, next);
  return state(word, since, "brain", source, evidence, next);
}

/** Builds one complete server-authoritative state value. */
function state(word, since, owner, source, evidence, next) {
  return { word, since, owner, evidence: { source, text: String(evidence ?? "") }, next: String(next ?? "") };
}

/** Parses one state boundary and falls back to the observation time. */
function timestamp(value, now) {
  const parsed = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : now;
}

/** Reads the harness family from one stored launch reference. */
function harnessOf(value) {
  const ref = String(value ?? "").trim();
  return ref ? ref.split("/")[0] : null;
}

/** Converts one legacy status token into a display word. */
function title(value) {
  const text = String(value ?? "Open");
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

/** Formats a short evidence age for state diagnostics. */
function age(ms) {
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)} minutes` : `${Math.floor(ms / 1000)} seconds`;
}
