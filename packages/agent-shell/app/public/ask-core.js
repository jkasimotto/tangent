// The one datatype of Julian's attention surface (design contract:
// otto/tangent/design-the-for-you-row-shows-only-direct-asks, solution:
// otto/tangent/impl-the-for-you-row-shows-only-direct-asks).
//
// A row on the For you card exists only when it asks Julian something and
// says what the answer is. That rule is structural here, not prose in a
// prompt: `makeAsk` is the only way an ask exists, and it refuses anything
// without a question that ends in `?` and at least one answer action. Every
// source of rows (the brain's plan lines, a pane dialog, a stopped step, a
// handover that names him) passes through one of the builders below, so a
// machine state on its own can never make a row.
//
// It is a plain script that registers a global, the same shape as
// goal-card-core.js, so the browser and the tests load one copy. Pure:
// no DOM, no fetch, no clock.

  /** The action verbs a row may carry. Anything else refuses the ask. */
  const ACTION_KINDS = new Set([
    "open-document",
    "open-brain",
    "open-run",
    "reveal-goal",
    "select-definition",
    "answer",
    "accept",
    "reject",
    "reply",
    "request-answer",
  ]);

  /** The question Tangent puts under every Test row; the brain never writes it. */
  const TEST_QUESTION = "Accept it?";
  /** The question a dialog row falls back to when the pane text yields none. */
  const DIALOG_QUESTION = "Answer its dialog?";
  /** The question a finished Goal that waits on Julian asks. */
  const RESULT_QUESTION = "Accept the result?";

  /** True when the value is a string with something in it. */
  function filled(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  /** True when one action names a known verb, a label, and an argument object. */
  function validAction(action) {
    if (!action || typeof action !== "object") return false;
    if (!ACTION_KINDS.has(action.kind)) return false;
    if (!filled(action.label)) return false;
    return Boolean(action.arg) && typeof action.arg === "object";
  }

  /**
   * The only constructor of an ask. Returns the frozen ask, or null when the
   * input is not a direct ask: no Area, no subject, no question, a question
   * that does not end in `?`, no action, or an action in an unknown verb.
   * Shape: { area, subject, detail, question, actions, source }.
   */
  function makeAsk({ area, subject, detail = "", question, actions, source = "" }) {
    if (!filled(area) || !filled(subject)) return null;
    if (!filled(question) || !question.trim().endsWith("?")) return null;
    if (!Array.isArray(actions) || !actions.length) return null;
    if (!actions.every(validAction)) return null;
    return Object.freeze({
      area: area.trim(),
      subject: subject.trim(),
      detail: String(detail ?? "").trim(),
      question: question.trim(),
      actions: Object.freeze(actions.map((action) => Object.freeze({ kind: action.kind, label: action.label, arg: action.arg }))),
      source: String(source ?? ""),
    });
  }

  /**
   * Reads a captured dialog line as a question: text that already asks is the
   * question, anything else becomes the fixed fallback with the text kept as
   * the detail, so a row never states a question the pane did not ask.
   */
  function dialogAsk(text) {
    const clean = String(text ?? "").trim();
    if (clean.endsWith("?") && clean.length > 1) return { question: clean, detail: "" };
    return { question: DIALOG_QUESTION, detail: clean };
  }

  /** The file-name slug of a vault path: no Area folders, no `.md`. */
  function fileNameSlug(file) {
    return String(file ?? "").split("/").pop().replace(/\.md$/i, "");
  }

  /** The Accept and Reject verbs of one plan line, in the order they are drawn. */
  function verdictActions(brain, row) {
    const arg = { area: brain.area, line: row.line };
    return [
      { kind: "accept", label: "Accept", arg },
      { kind: "reject", label: "Reject", arg },
    ];
  }

  /**
   * The Reply verb, which names the subject to the brain before its terminal
   * opens. A stopped brain has no terminal, so it carries no Reply.
   */
  function replyActions(brain, subject) {
    if (!brain.live) return [];
    return [{ kind: "reply", label: "Reply", arg: { area: brain.area, session: brain.session ?? "", subject } }];
  }

  /**
   * One resolved `## For Julian` plan row as an ask. Returns null for a row
   * Tangent must not show: an unresolved target, or a Test row whose Goal is
   * not done, so a landed-then-reopened Goal stops asking by itself.
   */
  function askFromPlanRow(brain, row) {
    if (!brain || !row || row.missing) return null;
    if (row.kind === "test") {
      if (row.goalStatus !== "done") return null;
      const subject = row.title ?? row.target ?? "";
      return makeAsk({
        area: brain.area,
        subject,
        detail: row.text,
        question: TEST_QUESTION,
        actions: [...verdictActions(brain, row), ...replyActions(brain, subject)],
        source: "plan",
      });
    }
    if (row.kind !== "decide") return null;
    if (!row.target) {
      return makeAsk({
        area: brain.area,
        subject: "Brain asks",
        question: row.text,
        actions: [{ kind: "answer", label: "Answer", arg: { area: brain.area, session: brain.session ?? "", subject: row.text } }],
        source: "plan",
      });
    }
    const subject = fileNameSlug(row.file);
    const detail = [
      row.unblocks ? `Unblocks: ${row.unblocks}` : "",
      row.commentCount ? `${row.commentCount} ${row.commentCount === 1 ? "comment" : "comments"} left` : "",
    ].filter(Boolean).join(" · ");
    return makeAsk({
      area: brain.area,
      subject,
      detail,
      question: row.text,
      actions: [
        { kind: "open-document", label: "Read", arg: { file: row.file } },
        ...verdictActions(brain, row),
        ...replyActions(brain, subject),
      ],
      source: "plan",
    });
  }

  /** One durable brain request. These records replace Markdown control lines. */
  function askFromRequest(brain, request) {
    if (!brain || !request || request.status !== "open") return null;
    const answers = request.kind === "plan"
      ? [["approve", "Approve plan"], ["request-changes", "Request changes"]]
      : request.kind === "test"
        ? [["pass", "Pass"], ["needs-work", "Needs work"]]
        : request.kind === "approval"
          ? [["approve", "Approve"], ["reject", "Reject"]]
          : (request.options ?? []).map((option) => [option, option]);
    return makeAsk({
      area: brain.area,
      subject: request.subject,
      detail: request.detail,
      question: request.question,
      actions: answers.map(([answer, label]) => ({ kind: "request-answer", label, arg: { area: brain.area, id: request.id, answer } })),
      source: `request:${request.kind}`,
    });
  }

  /**
   * A live brain sitting at its own dialog. A blocked brain cannot write a
   * plan line about its own blockage, so Tangent asks for it.
   */
  function askFromBrainDialog(brain) {
    if (!brain || !brain.live || brain.stateDetail !== "decision") return null;
    const { question, detail } = dialogAsk(brain.stateQuestion);
    return makeAsk({
      area: brain.area,
      subject: "Brain",
      detail,
      question,
      actions: [{ kind: "open-brain", label: "Open brain", arg: { session: brain.session ?? "" } }],
      source: "brain-dialog",
    });
  }

  /** A pipeline step that stopped: it runs again or it is skipped, and only Julian says which. */
  function askFromStoppedStep(goal, step) {
    if (!goal || !step) return null;
    return makeAsk({
      area: goal.area,
      subject: goal.title,
      question: `Step ${step.index} stopped. Restart or skip it?`,
      actions: [{ kind: "reveal-goal", label: "See steps", arg: { file: goal.file } }],
      source: "step",
    });
  }

  /**
   * A session stopped at a dialog. `target` is the Goal it runs, or null for
   * a describe-work session; the caller passes the one action that opens it.
   */
  function askFromDialogSession(target, session, { action } = {}) {
    if (!session || session.stateDetail !== "decision") return null;
    const { question, detail } = dialogAsk(session.stateQuestion);
    return makeAsk({
      area: target?.area ?? session.area,
      subject: target?.title ?? session.workTitle ?? "Define new work",
      detail,
      question,
      actions: [action],
      source: "dialog",
    });
  }

  /**
   * A Goal whose stored handover names Julian. A finished Goal asks him to
   * accept the result; work still running asks only when the handover text
   * is itself a question, so "waiting for Julian" alone never makes a row.
   */
  function askFromWaitingOn(goal, { finished = false } = {}) {
    if (!goal || !/\b(julian|you)\b/i.test(String(goal.waitingOn ?? ""))) return null;
    const text = String(goal.waitingOn ?? "").trim();
    const question = finished ? RESULT_QUESTION : text;
    if (!finished && !question.endsWith("?")) return null;
    return makeAsk({
      area: goal.area,
      subject: goal.title,
      detail: finished ? text : "",
      question,
      actions: [{ kind: "reveal-goal", label: "Open the Goal", arg: { file: goal.file } }],
      source: "handover",
    });
  }

export default {
    makeAsk,
    askFromRequest,
    askFromPlanRow,
    askFromBrainDialog,
    askFromStoppedStep,
    askFromDialogSession,
    askFromWaitingOn,
    TEST_QUESTION,
    DIALOG_QUESTION,
    RESULT_QUESTION,
  };
