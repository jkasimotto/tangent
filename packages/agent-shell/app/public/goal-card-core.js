// The facts line of a Goal card (design contract: otto/tangent/design-goal-cards,
// solution: otto/tangent/impl-goal-cards).
//
// Julian scans the work desk to answer one question per Goal: is it moving,
// or does it wait for me, and for how long. Everything here is a pure
// function over the vault payload, the live session list, and the pipeline
// record: how many agents worked the Goal, how long it runs or ran, and how
// long it has waited for him. No DOM, no clock of its own; the caller passes
// `now`. It is a plain script that registers a global, the same shape as
// area-map-core.js, so the browser and the tests load one copy.

  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  /** How much of a handover line the waiting fact keeps in its hover title. */
  const TITLE_CHARS = 200;

  /**
   * A duration a reader takes in at a glance: `<1m`, `12m`, `2h 05m`,
   * `1d 4h`. Minutes stay two digits after hours so the numbers line up;
   * days drop the minutes, because a wait that old is not read to the minute.
   */
  function durationLabel(ms) {
    const total = Math.max(0, Number(ms) || 0);
    if (total < MINUTE) return "<1m";
    if (total < HOUR) return `${Math.floor(total / MINUTE)}m`;
    if (total < DAY) return `${Math.floor(total / HOUR)}h ${String(Math.floor((total % HOUR) / MINUTE)).padStart(2, "0")}m`;
    return `${Math.floor(total / DAY)}d ${Math.floor((total % DAY) / HOUR)}h`;
  }

  /**
   * Step statuses that never change again. Mirrors FINAL_STATUSES in
   * pipeline-record.mjs, which the browser cannot import.
   */
  const FINAL_STEP_STATUSES = new Set(["complete", "skipped", "ended"]);

  /**
   * The step a Goal card speaks for: the one the run is actually on. A pipeline
   * leaves earlier attempts behind it, so a step a later step already moved
   * past is history and must not speak for the card. Without this rule a
   * stopped step 1 outranks a live step 2, so the card reads `Stopped 1/2` with
   * no way into the working agent, and it keeps reading `Stopped 1/2` after
   * step 2 completes and the run is over
   * (goal-every-goal-card-on-work-has-a-way-to-open-its-ag).
   * Order: the live running step, then the newest step that ran and has not
   * finished, then the first step still to start. Null means the run is over
   * and the card falls back to the plain Goal state.
   */
  function currentPipelineStep(steps = []) {
    const live = steps.filter((step) => step.status === "running" && step.live);
    if (live.length) return live[live.length - 1];
    const touched = steps.filter((step) => step.status !== "pending");
    const last = touched.length ? touched[touched.length - 1] : null;
    if (last && !FINAL_STEP_STATUSES.has(last.status)) return last;
    return steps.find((step) => step.status === "pending") ?? null;
  }

  /** Milliseconds from an ISO time on a pipeline step, or 0 when it has none. */
  function stepTime(value) {
    const at = Date.parse(String(value ?? ""));
    return Number.isFinite(at) ? at : 0;
  }

  /** The first line of a stored handover or waiting note, clipped for a hover title. */
  function firstLine(text) {
    const line = String(text ?? "").trim().split("\n")[0].trim();
    return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
  }

  /** Why a static agent waits, in Julian's words, for the waiting fact's hover title. */
  function waitReason(item) {
    if (item.state === "shell") return "Agent did not start";
    if (item.stateDetail === "decision") return item.stateQuestion ? `Needs your decision: ${firstLine(item.stateQuestion)}` : "Needs your decision";
    if (item.stateDetail === "idle") return "Finished · ready for you";
    if (item.stateDetail === "draft") return "Holding your draft";
    return "Waiting for you";
  }

  /** A waiting fact from a start time the server may not know after a restart. */
  function waitFrom(since, now, title) {
    const at = Number(since) || 0;
    return { ms: at ? Math.max(0, now - at) : null, title };
  }

  /**
   * The first live session or pipeline step that waits for Julian, in the
   * order the card trusts: a session bound to the Goal, then a running step
   * whose session is not bound, then a stopped step, then a stored handover.
   * While any agent on the Goal works, the Goal waits for nobody: a pipeline
   * leaves the panes of finished steps sitting idle at their prompt, and they
   * must not read as a wait for Julian.
   */
  function waitingFact({ goal, sessions, steps, now, handoffNeedsYou }) {
    const working = sessions.some((session) => session.state === "working")
      || steps.some((step) => step.status === "running" && step.live && step.state === "working");
    if (working) return null;
    const bound = new Set(sessions.map((session) => session.name));
    const stalled = sessions.find((session) => session.state === "waiting" || session.state === "shell");
    if (stalled) return waitFrom(stalled.waitingSince, now, waitReason(stalled));
    const stepWaiting = steps.find((step) => step.status === "running" && step.live && (step.state === "waiting" || step.state === "shell") && !bound.has(step.session));
    if (stepWaiting) return waitFrom(stepWaiting.waitingSince, now, `Step ${stepWaiting.index}: ${waitReason(stepWaiting)}`);
    const current = currentPipelineStep(steps);
    const stepStopped = current && (current.status === "stopped" || (current.status === "running" && !current.live)) ? current : null;
    if (stepStopped) return waitFrom(stepTime(stepStopped.endedAt), now, `Step ${stepStopped.index} stopped`);
    const needsYou = handoffNeedsYou === null || handoffNeedsYou === undefined
      ? /\b(julian|you)\b/i.test(String(goal.waitingOn ?? ""))
      : Boolean(handoffNeedsYou);
    if (sessions.length || !needsYou) return null;
    const handedOver = Math.max(Number(goal.lastEndAt) || 0, ...steps.map((step) => stepTime(step.endedAt)));
    return waitFrom(handedOver, now, firstLine(goal.waitingOn) || "Waiting for you");
  }

  /**
   * The facts of one Goal card. Pure: the caller passes the clock.
   *   goal:     { status, waitingOn, agents, firstStartAt, lastEndAt }
   *   sessions: the live sessions bound to the Goal
   *   pipeline: the pipeline record with live facts folded in, or null
   *   handoffNeedsYou: whether a stored handover still waits for Julian; the
   *     caller decides, because a live Area brain answers its own Goals
   * Returns { agentCount, startedAt, running, waiting }, where a fact the
   * records cannot answer is null and never a guess.
   */
  function goalCardFacts({ goal, sessions = [], pipeline = null, now, handoffNeedsYou = null }) {
    const steps = pipeline?.steps ?? [];
    const live = sessions.filter((session) => session.state !== "shell");
    const stepSessions = steps.map((step) => step.session).filter(Boolean);
    const agentCount = new Set([...(goal.agents ?? []), ...sessions.map((session) => session.name), ...stepSessions]).size;
    const sessionStarts = sessions.map((session) => Number(session.created) || 0).filter(Boolean);
    const stepStarts = steps.map((step) => stepTime(step.startedAt)).filter(Boolean);
    const startedAt = Number(goal.firstStartAt) || Math.min(...sessionStarts, ...stepStarts, Infinity);
    const started = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null;
    let running = null;
    if (started && live.length) running = { word: "running", ms: Math.max(0, now - started) };
    else if (started) {
      const endedAt = Math.max(Number(goal.lastEndAt) || 0, ...steps.map((step) => stepTime(step.endedAt)));
      if (endedAt > started) running = { word: "ran", ms: endedAt - started };
    }
    return { agentCount, startedAt: started, running, waiting: waitingFact({ goal, sessions, steps, now, handoffNeedsYou }) };
  }

  /**
   * The facts line as segments the card prints in order, middle dots between
   * them. A Goal nobody has started says so instead of printing zeros.
   * `agentNames` fills the hover title of the agent count.
   */
  function factsSegments(facts, now, agentNames = []) {
    const segments = [];
    if (facts.agentCount) {
      segments.push({
        text: facts.agentCount === 1 ? "1 agent" : `${facts.agentCount} agents`,
        kind: "agents",
        title: agentNames.join(", "),
      });
    } else if (!facts.running) {
      segments.push({ text: "no agent yet", kind: "agents", title: "" });
    }
    if (facts.running) {
      segments.push({
        text: `${facts.running.word} ${durationLabel(facts.running.ms)}`,
        kind: "running",
        title: facts.startedAt ? `Started ${new Date(facts.startedAt).toLocaleString()}` : "",
      });
    }
    if (facts.waiting) {
      const since = facts.waiting.ms === null ? "" : `\nsince at least ${new Date(now - facts.waiting.ms).toLocaleString()}`;
      segments.push({
        text: facts.waiting.ms === null ? "waiting for you" : `waiting for you ${durationLabel(facts.waiting.ms)}`,
        kind: "waiting",
        title: `${facts.waiting.title}${since}`,
      });
    }
    return segments;
  }

  /**
   * The Goal's total elapsed time (first start to now) as the same compact
   * text `durationLabel` prints elsewhere on the card, so the Status cell reads
   * the same span the card does. Null when the Goal has not started, so the
   * row prints no number.
   */
  function elapsedLabel(facts, now) {
    if (!facts.startedAt) return null;
    return durationLabel(now - facts.startedAt);
  }

export default { durationLabel, currentPipelineStep, goalCardFacts, factsSegments, elapsedLabel };
