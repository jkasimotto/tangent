// The study screen (design contract: otto/tangent/design-learning-ai-written-code
// Decision 7 first cut, solution impl-learning-ai-written-code Piece 4): real
// code in the left pane, the question anchored beside it, one keyboard-first
// answer box, and a verdict that quotes the evidence.
//
// The shell repaints its screen from strings and would blur the answer box on
// every poll, so this view owns its DOM, like the Area map: one module-level
// instance holds the nodes and re-attaches to whatever host the shell renders.
// The turns and the code pane are rebuilt when the record changes; the answer
// box never is.
(function (root) {
  "use strict";

  const POLL_MS = 1000;
  const HIDDEN_CODE = "The code stays hidden until you answer.";

  /** The one mounted study screen, kept across shell repaints. */
  let instance = null;

  /** Escapes text for HTML. */
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** GETs one JSON payload, or null when the request fails. */
  async function get(url) {
    try {
      const response = await fetch(url);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  /** POSTs one JSON body and returns { ok, payload }. */
  async function post(url, body) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { ok: response.ok, payload: await response.json().catch(() => ({})) };
    } catch (error) {
      return { ok: false, payload: { error: String(error.message ?? error) } };
    }
  }

  /** The newest tutor turn of a record, or null before the first one lands. */
  function lastTutorTurn(study) {
    for (let index = study.turns.length - 1; index >= 0; index -= 1) {
      if (study.turns[index].role === "tutor") return study.turns[index];
    }
    return null;
  }

  /** The snippet the code pane shows: the revealed code, else the question's own. */
  function currentSnippet(study) {
    const turn = lastTutorTurn(study);
    return turn?.reveal ?? turn?.question?.snippet ?? null;
  }

  /** The question waiting for an answer, or null. */
  function currentQuestion(study) {
    return lastTutorTurn(study)?.question ?? null;
  }

  /** One code pane: the file and range as a header, then the lines with a gutter. */
  function renderCode(study) {
    const snippet = currentSnippet(study);
    if (!snippet) return `<header>Hidden</header><p class="study-code-empty">${esc(HIDDEN_CODE)}</p>`;
    const where = `${esc(snippet.file)} <span>lines ${snippet.start}–${snippet.end}${snippet.truncated ? ", cut" : ""}</span>`;
    if (snippet.error || typeof snippet.text !== "string") {
      return `<header>${where}</header><p class="study-code-empty">The server could not read that code: ${esc(snippet.error ?? "no text")}</p>`;
    }
    const lines = snippet.text.split("\n").map((line, index) => `<tr><td class="study-line">${snippet.start + index}</td><td><code>${esc(line) || "&nbsp;"}</code></td></tr>`);
    return `<header>${where}</header><pre class="study-code-body"><table>${lines.join("")}</table></pre>`;
  }

  /** One verdict: the result, the quoted evidence, and the named gap. */
  function renderVerdict(verdict) {
    return `
      <div class="study-verdict ${esc(verdict.result)}">
        <span class="study-verdict-result">${esc(verdict.result)}</span>
        <blockquote>${esc(verdict.evidence)}</blockquote>
        ${verdict.note ? `<p>${esc(verdict.note)}</p>` : ""}
      </div>`;
  }

  /** One turn of the dialogue: Julian's answer, or the tutor's line, verdict, and question. */
  function renderTurn(turn) {
    if (turn.role === "julian") return `<li class="study-turn julian"><p>${esc(turn.text)}</p></li>`;
    const question = turn.question
      ? `<div class="study-question">
           <span class="study-question-frame">Question ${turn.question.index} of ${turn.question.total} · ${esc(turn.question.type)}</span>
           <p>${esc(turn.question.text)}</p>
         </div>`
      : "";
    return `
      <li class="study-turn tutor">
        ${turn.say ? `<p class="study-say">${esc(turn.say)}</p>` : ""}
        ${turn.verdict ? renderVerdict(turn.verdict) : ""}
        ${question}
      </li>`;
  }

  /** The frame line: what is being studied, the mode, and where the session stands. */
  function frameText(study, pendingSeconds) {
    if (study.pending) return `The tutor is reading the code… ${pendingSeconds}s`;
    if (study.status === "closed") return `Closed · ${study.subsystem}`;
    const question = currentQuestion(study);
    const where = question ? `question ${question.index} of ${question.total}` : "starting";
    return `${study.subsystem} · ${study.mode} · ${where}`;
  }

  /** Builds the start form: a subsystem, an optional repository, and one Start button. */
  function buildStart(instance, lastRecord) {
    const node = document.createElement("form");
    node.className = "study-start";
    node.innerHTML = `
      <h2>Study code</h2>
      <p class="study-start-lead">Name the subsystem. The tutor reads it, asks, and grades what you answer.</p>
      ${lastRecord ? `<p class="study-last-record">Last session: ${esc(lastRecord)}</p>` : ""}
      <label>Subsystem<input type="text" name="subsystem" placeholder="the vault git log pass" autocomplete="off" required></label>
      <label>Repository <small>empty = the Area's own</small><input type="text" name="repo" placeholder="" autocomplete="off"></label>
      <p class="study-start-error" hidden></p>
      <button type="submit">Start</button>`;
    node.addEventListener("submit", (event) => {
      event.preventDefault();
      startSession(instance, node);
    });
    return node;
  }

  /** Builds the session view once: the code pane, the dialogue, and the answer box. */
  function buildSession(instance) {
    const node = document.createElement("div");
    node.className = "study-session";
    node.innerHTML = `
      <section class="study-code" aria-label="The code in question"></section>
      <section class="study-dialogue">
        <div class="study-frame"><span class="study-frame-text"></span><button type="button" class="study-end">End session</button></div>
        <ol class="study-turns"></ol>
        <div class="study-failure" hidden></div>
        <form class="study-answer">
          <textarea rows="3" placeholder="Your answer" spellcheck="false"></textarea>
          <p class="study-hint">Enter answers · Shift+Enter newline · Esc ends the session</p>
        </form>
      </section>`;
    instance.codePane = node.querySelector(".study-code");
    instance.framePane = node.querySelector(".study-frame-text");
    instance.turnsPane = node.querySelector(".study-turns");
    instance.failurePane = node.querySelector(".study-failure");
    instance.answerBox = node.querySelector("textarea");
    node.querySelector(".study-end").addEventListener("click", () => endSession(instance));
    node.querySelector(".study-answer").addEventListener("submit", (event) => {
      event.preventDefault();
      submitAnswer(instance);
    });
    instance.answerBox.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitAnswer(instance);
        return;
      }
      if (event.key === "Escape" && !instance.answerBox.value.trim()) {
        event.preventDefault();
        event.stopPropagation();
        endSession(instance);
      }
    });
    instance.failurePane.addEventListener("click", (event) => {
      if (event.target.closest(".study-retry")) retryAnswer(instance);
    });
    return node;
  }

  /** Builds the closed view: the one-line record, then a way back to the start form. */
  function buildClosed(instance, study) {
    const node = document.createElement("div");
    node.className = "study-closed";
    node.innerHTML = `
      <h2>Session closed</h2>
      <p class="study-record">${esc(study.record ?? "session ended")}</p>
      <p class="study-closed-where">${esc(study.subsystem)}</p>
      <button type="button" class="study-again">Start another session</button>`;
    node.querySelector(".study-again").addEventListener("click", () => {
      instance.study = null;
      instance.lastRecord = study.record ?? "";
      show(instance, "start");
    });
    return node;
  }

  /** Replaces the screen's one child with the view named, and paints it. */
  function show(instance, view) {
    instance.view = view;
    instance.root.textContent = "";
    if (view === "start") {
      instance.root.appendChild(buildStart(instance, instance.lastRecord));
      instance.root.querySelector("input[name=subsystem]").focus();
      return;
    }
    if (view === "closed") {
      instance.root.appendChild(buildClosed(instance, instance.study));
      return;
    }
    instance.signature = "";
    instance.root.appendChild(buildSession(instance));
    paintSession(instance);
  }

  /**
   * Patches the session view from the record. The turns and the code pane are
   * rebuilt only when the record changed; the answer box is never rebuilt, so
   * a poll can never take the cursor out of a half-written answer.
   */
  function paintSession(instance) {
    const study = instance.study;
    if (!study || instance.view !== "session") return;
    const seconds = study.pending ? Math.max(0, Math.round((Date.now() - instance.pendingSince) / 1000)) : 0;
    instance.framePane.textContent = frameText(study, seconds);
    const signature = `${study.turns.length}|${study.pending}|${study.error ?? ""}|${study.status}`;
    if (signature === instance.signature) return;
    instance.signature = signature;
    instance.codePane.innerHTML = renderCode(study);
    instance.turnsPane.innerHTML = study.turns.map(renderTurn).join("");
    instance.turnsPane.scrollTop = instance.turnsPane.scrollHeight;
    instance.failurePane.hidden = !study.error;
    instance.failurePane.innerHTML = study.error
      ? `<p>${esc(study.error)}</p>${instance.lastAnswer ? `<button type="button" class="study-retry">Send that answer again</button>` : ""}`
      : "";
    instance.answerBox.disabled = study.pending;
    if (!study.pending) instance.answerBox.focus({ preventScroll: true });
  }

  /** Takes one fresh record: closes the view when the tutor closed the session. */
  function apply(instance, study) {
    if (!study) return;
    const wasPending = instance.study?.pending;
    instance.study = study;
    if (study.pending && !wasPending) instance.pendingSince = Date.now();
    if (study.status === "closed") {
      stopPolling(instance);
      if (instance.view !== "closed") show(instance, "closed");
      return;
    }
    paintSession(instance);
  }

  /** Starts the once-a-second tick: the elapsed line every tick, a poll every other one. */
  function startPolling(instance) {
    if (instance.timer) return;
    instance.tick = 0;
    instance.timer = setInterval(async () => {
      instance.tick += 1;
      if (!instance.study) return;
      if (!instance.study.pending) {
        stopPolling(instance);
        return;
      }
      paintSession(instance);
      if (instance.tick % 2) return;
      const payload = await get(`/api/study/state?id=${encodeURIComponent(instance.study.id)}`);
      if (payload?.study) apply(instance, payload.study);
    }, POLL_MS);
  }

  /** Stops the tick. */
  function stopPolling(instance) {
    if (!instance.timer) return;
    clearInterval(instance.timer);
    instance.timer = null;
  }

  /** Opens a session from the start form, then swaps to the session view. */
  async function startSession(instance, form) {
    const error = form.querySelector(".study-start-error");
    const button = form.querySelector("button");
    button.disabled = true;
    const { ok, payload } = await post("/api/study/start", {
      area: instance.area,
      subsystem: form.elements.subsystem.value,
      repo: form.elements.repo.value,
    });
    button.disabled = false;
    if (!ok || !payload.study) {
      error.hidden = false;
      error.textContent = payload.error ?? "the session did not start";
      return;
    }
    instance.study = payload.study;
    instance.pendingSince = Date.now();
    instance.lastAnswer = "";
    show(instance, "session");
    startPolling(instance);
  }

  /** Sends the answer in the box and starts the turn that grades it. */
  async function submitAnswer(instance) {
    const text = instance.answerBox.value.trim();
    if (!text || instance.study?.pending) return;
    instance.answerBox.value = "";
    instance.lastAnswer = text;
    await sendAnswer(instance, text);
  }

  /** Sends one answer again after a failed tutor turn. */
  async function retryAnswer(instance) {
    if (!instance.lastAnswer || instance.study?.pending) return;
    await sendAnswer(instance, instance.lastAnswer);
  }

  /** POSTs one answer and takes the record the server returns. */
  async function sendAnswer(instance, text) {
    const { ok, payload } = await post("/api/study/answer", { id: instance.study.id, text });
    if (!ok) {
      instance.study = { ...instance.study, error: payload.error ?? "the answer did not reach the tutor" };
      instance.signature = "";
      paintSession(instance);
      return;
    }
    apply(instance, payload.study);
    startPolling(instance);
  }

  /** Ends the session: the tutor closes it with its one-line record. */
  async function endSession(instance) {
    if (!instance.study || instance.study.status === "closed") return;
    const { ok, payload } = await post("/api/study/end", { id: instance.study.id });
    if (!ok) {
      instance.study = { ...instance.study, error: payload.error ?? "the session did not end" };
      instance.signature = "";
      paintSession(instance);
      return;
    }
    apply(instance, payload.study);
    startPolling(instance);
  }

  /**
   * Attaches the study screen to the host the shell just rendered. The
   * instance survives repaints: only a different Area builds a new one.
   */
  function mount(host, { area }) {
    if (instance && instance.area === area) {
      if (instance.root.parentElement !== host) host.appendChild(instance.root);
      return instance;
    }
    if (instance) stopPolling(instance);
    instance = { area, root: document.createElement("div"), study: null, view: "start", lastRecord: "", lastAnswer: "", pendingSince: Date.now(), timer: null, signature: "" };
    instance.root.className = "study-root";
    host.appendChild(instance.root);
    show(instance, "start");
    const mounted = instance;
    get(`/api/study/latest?area=${encodeURIComponent(area)}`).then((payload) => {
      if (mounted !== instance || !payload) return;
      const study = payload.study;
      if (study && study.status === "open") {
        instance.study = study;
        instance.pendingSince = Date.now();
        show(instance, "session");
        if (study.pending) startPolling(instance);
        return;
      }
      if (study?.record) {
        instance.lastRecord = study.record;
        if (instance.view === "start") show(instance, "start");
      }
    });
    return instance;
  }

  root.AgentShellStudy = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);
