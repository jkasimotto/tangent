import { createHash } from "node:crypto";
import { mapWithConcurrency } from "./bounded-work.mjs";
import { classifyStaticPane, classifyWorkingComposer, parseContextFill, stabilizeStaticPane, staticSinceOf } from "./pane-state.mjs";

/** Owns passive tmux pane samples and their derived agent state. */
export function createPaneObserver({ runTmux, shellCommands, minSampleMs = 1200, waitStableMs = 8_000, concurrency = 8, now = Date.now }) {
  const samples = new Map();

  /** Hashes one visible pane for prompt-readiness sampling. */
  async function hash(name) {
    const { stdout } = await runTmux(["capture-pane", "-p", "-t", `=${name}:`]);
    return createHash("sha1").update(stdout).digest("hex");
  }

  /** Reads one pane cursor, conservatively degrading to the origin. */
  async function cursor(name) {
    try {
      const { stdout } = await runTmux(["display-message", "-p", "-t", `=${name}:`, "#{cursor_x} #{cursor_y}"]);
      const [cursorX, cursorY] = stdout.trim().split(/\s+/).map(Number);
      return { cursorX: Number.isFinite(cursorX) ? cursorX : 0, cursorY: Number.isFinite(cursorY) ? cursorY : 0 };
    } catch {
      return { cursorX: 0, cursorY: 0 };
    }
  }

  /** Classifies one session against its previous sample. */
  async function classify(name, command, at, harness = null) {
    const previous = samples.get(name);
    if (shellCommands.has(command)) {
      const shellSince = previous?.state === "shell" ? previous.staticSince ?? at : at;
      const observation = observationOf({ at, harness, process: "shell", state: "shell", detail: null, question: "", context: null, composer: "none", lastOutputAt: previous?.lastOutputAt ?? null, activitySource: "none" });
      samples.set(name, { hash: "", at, state: "shell", detail: null, question: "", staticSince: shellSince, context: null, observation, lastOutputAt: previous?.lastOutputAt ?? null });
      return { state: "shell", detail: null, question: "", idleSince: null, waitingSince: shellSince, context: null, observation };
    }
    if (previous && at - previous.at < minSampleMs) {
      const waitingSince = previous.state === "waiting" || previous.state === "shell" ? previous.staticSince ?? null : null;
      return { state: previous.state, detail: previous.detail ?? null, question: previous.question ?? "", idleSince: previous.idleSince ?? null, waitingSince, context: previous.context ?? null, composer: previous.composer ?? null, observation: previous.observation ?? null };
    }
    const { stdout: text } = await runTmux(["capture-pane", "-p", "-t", `=${name}:`]);
    const nextHash = createHash("sha1").update(text).digest("hex");
    const context = parseContextFill(text);
    let cursorAt = null;
    /** Reads this pane's cursor at most once per sample. */
    const cursorOnce = async () => (cursorAt ??= await cursor(name));
    let state = !previous || previous.state === "shell" || nextHash !== previous.hash ? "working" : "waiting";
    let detail = null;
    let question = "";
    let quietSince = null;
    if (state === "waiting") {
      const stable = stabilizeStaticPane({
        classification: classifyStaticPane({ text, ...(await cursorOnce()), harness }),
        quietSince: previous?.hash === nextHash ? previous?.quietSince : null,
        now: at,
        thresholdMs: waitStableMs,
      });
      quietSince = stable.quietSince;
      if (stable.classification.kind === "working") state = "working";
      else if (stable.classification.kind !== "waiting") {
        detail = stable.classification.kind;
        question = stable.classification.question ?? "";
      }
    }
    // A repainting pane still has a composer, and the message queue needs to
    // know whether it is empty: an agent that works for an hour would
    // otherwise never be told anything (agent-messages.mjs, deliveryDecision).
    const composer = state === "working" ? classifyWorkingComposer({ text, ...(await cursorOnce()), harness }) : detail;
    const idleSince = state === "waiting" && (detail === "idle" || detail === null) ? (previous?.idleSince ?? at) : null;
    const staticSince = staticSinceOf({ previous, hash: nextHash, now: at });
    const changed = !previous || previous.state === "shell" || nextHash !== previous.hash;
    const lastOutputAt = changed || state === "working" ? at : previous?.lastOutputAt ?? null;
    const classified = classifyStaticPane({ text, ...(await cursorOnce()), harness });
    const wall = classified.kind === "wall" ? {
      ...classified.wall,
      since: sameWall(previous?.observation?.wall, classified.wall) ? previous.observation.wall.since ?? previous.observation.at : at,
    } : null;
    const observation = observationOf({
      at,
      harness,
      process: "harness",
      state,
      detail,
      question,
      wall,
      context,
      composer: composer === "idle" || detail === "idle" ? "idle" : composer === "draft" || detail === "draft" ? "draft" : "none",
      lastOutputAt,
      activitySource: state === "working" ? (hasRunningMarker(classified) ? "busy-marker" : "screen") : "none",
    });
    samples.set(name, { hash: nextHash, at, state, detail, question, idleSince, quietSince, staticSince, context, composer, observation, lastOutputAt });
    return { state, detail, question, idleSince, waitingSince: state === "waiting" ? staticSince : null, context, composer, observation };
  }

  /** Adds observed state to sessions and forgets panes that no longer exist. */
  async function enrich(sessions) {
    const at = now();
    const enriched = await mapWithConcurrency(sessions, concurrency, async (session) => {
      if (["process", "service", "command"].includes(session.kind)) {
        return { ...session, state: shellCommands.has(session.command) ? "stopped" : "service", stateDetail: null, stateQuestion: "", context: null, composer: null };
      }
      try {
        const harness = String(session.launchRef ?? "").split("/")[0] || null;
        const observed = await classify(session.name, session.command, at, harness);
        return { ...session, state: observed.state, stateDetail: observed.detail, stateQuestion: observed.question, idleSince: observed.idleSince ?? null, waitingSince: observed.waitingSince ?? null, context: observed.context ?? null, composer: observed.composer ?? null, observedAt: at, fresh: true, observation: observed.observation };
      } catch {
        const previous = samples.get(session.name);
        const observation = previous?.observation ? { ...previous.observation, fresh: false } : { at, fresh: false, harness: String(session.launchRef ?? "").split("/")[0] || null, process: "other", activity: { lastOutputAt: null, source: "none" }, composer: "none", dialog: null, wall: null, context: null, transcript: null };
        return { ...session, state: previous?.state ?? null, stateDetail: previous?.detail ?? null, stateQuestion: previous?.question ?? "", context: previous?.context ?? null, composer: previous?.composer ?? null, observedAt: observation.at, fresh: false, observation };
      }
    });
    const live = new Set(sessions.map((session) => session.name));
    for (const name of samples.keys()) if (!live.has(name)) samples.delete(name);
    return enriched;
  }

  /** Returns the most recently observed context fill for one pane. */
  function context(name) {
    return samples.get(name)?.context ?? null;
  }

  return { context, enrich, hash };
}

/** Keeps the start time of one unchanged terminal wall across pane samples. */
function sameWall(previous, current) {
  return Boolean(previous && current && previous.kind === current.kind && previous.model === current.model && previous.text === current.text);
}

/** Converts one passive pane sample into the observation contract. */
function observationOf({ at, harness, process, state, detail, question, wall = null, context, composer, lastOutputAt, activitySource }) {
  return {
    at,
    fresh: true,
    harness,
    process,
    activity: { lastOutputAt, source: activitySource },
    composer,
    dialog: detail === "decision" ? { question, source: "screen" } : null,
    wall,
    context,
    transcript: null,
  };
}

/** Returns whether the harness shows positive running output. */
function hasRunningMarker(classification) {
  return classification?.kind === "working";
}
