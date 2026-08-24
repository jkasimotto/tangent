import { createHash } from "node:crypto";
import { mapWithConcurrency } from "./bounded-work.mjs";
import { classifyStaticPane, parseContextFill, stabilizeStaticPane, staticSinceOf } from "./pane-state.mjs";

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
  async function classify(name, command, at) {
    const previous = samples.get(name);
    if (shellCommands.has(command)) {
      const shellSince = previous?.state === "shell" ? previous.staticSince ?? at : at;
      samples.set(name, { hash: "", at, state: "shell", detail: null, question: "", staticSince: shellSince, context: null });
      return { state: "shell", detail: null, question: "", idleSince: null, waitingSince: shellSince, context: null };
    }
    if (previous && at - previous.at < minSampleMs) {
      const waitingSince = previous.state === "waiting" || previous.state === "shell" ? previous.staticSince ?? null : null;
      return { state: previous.state, detail: previous.detail ?? null, question: previous.question ?? "", idleSince: previous.idleSince ?? null, waitingSince, context: previous.context ?? null };
    }
    const { stdout: text } = await runTmux(["capture-pane", "-p", "-t", `=${name}:`]);
    const nextHash = createHash("sha1").update(text).digest("hex");
    const context = parseContextFill(text);
    let state = !previous || previous.state === "shell" || nextHash !== previous.hash ? "working" : "waiting";
    let detail = null;
    let question = "";
    let quietSince = null;
    if (state === "waiting") {
      const stable = stabilizeStaticPane({
        classification: classifyStaticPane({ text, ...(await cursor(name)) }),
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
    const idleSince = state === "waiting" && (detail === "idle" || detail === null) ? (previous?.idleSince ?? at) : null;
    const staticSince = staticSinceOf({ previous, hash: nextHash, now: at });
    samples.set(name, { hash: nextHash, at, state, detail, question, idleSince, quietSince, staticSince, context });
    return { state, detail, question, idleSince, waitingSince: state === "waiting" ? staticSince : null, context };
  }

  /** Adds observed state to sessions and forgets panes that no longer exist. */
  async function enrich(sessions) {
    const at = now();
    const enriched = await mapWithConcurrency(sessions, concurrency, async (session) => {
      if (["process", "service", "command"].includes(session.kind)) {
        return { ...session, state: shellCommands.has(session.command) ? "stopped" : "service", stateDetail: null, stateQuestion: "", context: null };
      }
      try {
        const observed = await classify(session.name, session.command, at);
        return { ...session, state: observed.state, stateDetail: observed.detail, stateQuestion: observed.question, idleSince: observed.idleSince ?? null, waitingSince: observed.waitingSince ?? null, context: observed.context ?? null };
      } catch {
        return { ...session, state: null, stateDetail: null, stateQuestion: "", context: null };
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
