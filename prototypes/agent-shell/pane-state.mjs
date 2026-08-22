// Refined classification of a static agent pane. The screen-hash poll in
// server.mjs separates "working" (repainting) from "not working" (static).
// This module reads the static screen and says WHY it is static: the agent
// needs a decision, or it sits at an empty composer, or it holds an unsent
// draft. Detection is passive: it only reads text and the cursor position.
// It never types a key, because one typed character can select a dialog
// option ("1" answers a claude permission dialog).
//
// The patterns are data, keyed by harness family for maintenance, but the
// classifier runs every set against every pane: pane_current_command does not
// name the harness reliably (claude reports its version string), and the
// prompt characters do not collide across harnesses.

/**
 * Screen signatures per harness family. Fixtures in fixtures/panes/ hold real
 * captures; when a harness update changes its screens, a fixture test fails
 * and this table is the one place to update.
 */
export const PANE_SIGNATURES = {
  pi: {
    // Pi keeps this status row visible throughout model reasoning and tool
    // execution. Some providers pause the spinner between streamed chunks,
    // so screen diffing alone briefly mistakes active work for a wait.
    busy: [/\bWorking(?:\.\.\.|…)/i],
    dialog: [],
    composer: { prompt: /^❯(\s|$)/, homeColumn: 2 },
  },
  claude: {
    // Shown in the status line only while the agent works. A static screen
    // with this marker is a long tool call, not a finished response.
    busy: [/esc to interrupt/i],
    // Permission dialogs, plan approval, and AskUserQuestion all show a
    // question plus an arrow-selected numbered option row.
    dialog: [/Do you want/i, /❯\s+\d+\./],
    // The idle composer is a bare prompt line; a draft moves the cursor past
    // the home column.
    composer: { prompt: /^❯(\s|$)/, homeColumn: 2 },
  },
  codex: {
    busy: [/esc to interrupt/i],
    dialog: [/\(y\/n\)/i, /press y to approve/i],
    // Codex paints gray placeholder text after the prompt. Placeholder text
    // never moves the cursor, so "cursor at home column" still means empty.
    composer: { prompt: /^›(\s|$)/, homeColumn: 2 },
  },
  generic: {
    busy: [],
    dialog: [],
    composer: { prompt: /^>(\s|$)/, homeColumn: 2 },
  },
};

/**
 * A pane that started a shell of its own and is waiting for it. Claude Code
 * prints "Running in the background", a spinner line that counts the shells
 * still running, and keeps a shell count in its status bar. The pane stops
 * repainting while that shell works, so the screen hash calls it static, but
 * the session waits on its own work and not on a person: it is working
 * (design-the-for-you-row-shows-only-direct-asks, Julian's answer 5). The
 * status-bar pattern is anchored on the separator the status line uses, so
 * ordinary output that mentions shells cannot match it.
 */
const BACKGROUND_SHELL = [
  /Running in the background/i,
  /\d+\s+shells?\s+still\s+running/i,
  /·\s*\d+\s+shells?\b/i,
];

/** True when the pane shows a background shell it started and still runs. */
export function hasRunningBackgroundShell(text) {
  const value = String(text ?? "");
  return BACKGROUND_SHELL.some((pattern) => pattern.test(value));
}

/**
 * Requires an unrecognized static pane to stay quiet before it becomes a
 * generic wait. Positive signals (busy marker, dialog, composer, or draft)
 * remain immediate. Returns the timestamp to carry into the next sample.
 */
export function stabilizeStaticPane({ classification, quietSince = null, now, thresholdMs }) {
  if (classification.kind !== "waiting") return { classification, quietSince: null };
  const since = quietSince ?? now;
  if (now - since < thresholdMs) return { classification: { kind: "working" }, quietSince: since };
  return { classification, quietSince: since };
}

/**
 * When a pane last stopped changing, the start of the "waiting for you"
 * duration on the Goal card (design-goal-cards Decision 3). A pane that
 * repainted since the last poll, one with no earlier sample, and a plain
 * shell have no static start: the answer is null. After a server restart the
 * first equal hash starts the clock at `now`, so the value is a lower bound.
 */
export function staticSinceOf({ previous, hash, now }) {
  if (!previous || previous.state === "shell" || previous.hash !== hash) return null;
  return previous.staticSince ?? now;
}

/**
 * Classifies one static pane. Input: the pane text exactly as
 * `tmux capture-pane -p` prints it, and the cursor position from
 * `#{cursor_x} #{cursor_y}`. Returns one of:
 *   { kind: "working" }                     - a busy marker is on screen, or a
 *                                             background shell it started runs
 *   { kind: "decision", question }          - a dialog waits for a choice
 *   { kind: "idle" }                        - an empty composer waits for input
 *   { kind: "draft" }                       - the composer holds unsent text
 *   { kind: "waiting" }                     - static, but nothing recognized
 */
export function classifyStaticPane({ text, cursorX = 0, cursorY = 0 }) {
  const lines = String(text ?? "").split("\n");
  for (const signature of Object.values(PANE_SIGNATURES)) {
    for (const pattern of signature.busy) {
      if (pattern.test(String(text))) return { kind: "working" };
    }
  }
  for (const signature of Object.values(PANE_SIGNATURES)) {
    for (const pattern of signature.dialog) {
      const line = lines.find((candidate) => pattern.test(candidate));
      if (line !== undefined) return { kind: "decision", question: dialogQuestion(lines) };
    }
  }
  // After the dialog sweep, so a pane that asks a question while a shell of
  // its own runs still reads as an ask, not as work.
  if (hasRunningBackgroundShell(text)) return { kind: "working" };
  const cursorLine = lines[cursorY] ?? "";
  for (const signature of Object.values(PANE_SIGNATURES)) {
    const { prompt, homeColumn } = signature.composer;
    if (!prompt.test(cursorLine)) continue;
    return cursorX <= homeColumn ? { kind: "idle" } : { kind: "draft" };
  }
  return { kind: "waiting" };
}

/**
 * The question a dialog asks, for the attention surfaces: the first line that
 * reads as a question, else the first option row's preceding text line.
 */
function dialogQuestion(lines) {
  const question = lines.find((line) => /\?\s*$/.test(line.trim()) && line.trim().length > 1);
  if (question) return question.trim();
  const optionIndex = lines.findIndex((line) => /❯\s+\d+\./.test(line));
  for (let index = optionIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index].trim();
    if (candidate && !/^[─│╭╰═-]+$/.test(candidate)) return candidate;
  }
  return "";
}
