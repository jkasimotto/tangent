// Refined classification of a static agent pane. The screen-hash poll in
// server.mjs separates "working" (repainting) from "not working" (static).
// This module reads the static screen and says WHY it is static: the agent
// needs a decision, or it sits at an empty composer, or it holds an unsent
// draft. Detection is passive: it only reads text and the cursor position.
// It never types a key, because one typed character can select a dialog
// option ("1" answers a claude permission dialog).
//
// The patterns are data, keyed by harness family for maintenance. Wall
// evidence is different from composer evidence: it is trusted only for the
// named launch family and only after a real harness capture proves it.

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
    wall: [],
    // Pi's editor prints no prompt character. The composer is the line between
    // two horizontal rules above the footer, cursor at column 0 when empty
    // (fixture pi-idle.txt, 0.84.x). The old `❯` prompt never matched a real
    // pi pane, so every pi session read as "no composer" and messages queued
    // forever (Julian, 2026-08-28).
    composer: { frame: /^─{10,}\s*$/, homeColumn: 0 },
    // Footer prints "6.8%/1.0M": percent used, then window size. Both numbers
    // mean used-of-window (pinned by the pi-working fixture).
    context: {
      pattern: /(\d+(?:\.\d+)?)%\/(\d+(?:\.\d+)?)M\b/,
      /** Converts Pi's percentage/window match into token counts. */
      read: (match) => {
        const windowTokens = Number(match[2]) * 1_000_000;
        const usedTokens = Math.round((Number(match[1]) / 100) * windowTokens);
        return { usedTokens, windowTokens };
      },
    },
  },
  claude: {
    // Shown in the status line only while the agent works. A static screen
    // with this marker is a long tool call, not a finished response.
    busy: [/esc to interrupt/i],
    // Permission dialogs, plan approval, and AskUserQuestion all show a
    // question plus an arrow-selected numbered option row.
    dialog: [/Do you want/i, /❯\s+\d+\./],
    wall: [
      { id: "claude-quota-reached-v1", kind: "quota", pattern: /^You(?:'|’)ve reached your (.+?) limit\.?$/i, model: 1 },
    ],
    // The idle composer is a bare prompt line; a draft moves the cursor past
    // the home column.
    composer: { prompt: /^❯(\s|$)/, homeColumn: 2 },
    // Statusline prints "8% (78k/1000k)": used, then window, both in k
    // tokens. This reads Julian's statusline configuration (not a stock
    // claude screen); a profile without that statusline degrades to
    // prompt-only fill (principle 7 of design-worker-context-handover).
    context: {
      pattern: /\((\d+(?:\.\d+)?)k\/(\d+(?:\.\d+)?)k\)/,
      /** Converts Claude's used/window match into token counts. */
      read: (match) => ({ usedTokens: Number(match[1]) * 1000, windowTokens: Number(match[2]) * 1000 }),
    },
  },
  codex: {
    busy: [/esc to interrupt/i],
    dialog: [/\(y\/n\)/i, /press y to approve/i, /Would you like to run the following command\?/i, /›\s+\d+\.\s+(?:Yes|No)/i],
    // No Codex wall capture is verified. In particular, an MCP login warning
    // belongs to that dependency and is not evidence about Codex login.
    wall: [],
    // Codex paints gray placeholder text after the prompt. Placeholder text
    // never moves the cursor, so "cursor at home column" still means empty.
    composer: { prompt: /^›(\s|$)/, homeColumn: 2 },
    // No context member: codex prints no fill in our captured fixture.
  },
  generic: {
    busy: [],
    dialog: [],
    wall: [],
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
export function classifyStaticPane({ text, cursorX = 0, cursorY = 0, harness = null }) {
  const lines = String(text ?? "").split("\n");
  const signatures = orderedSignatures(harness);
  for (const signature of signatures) {
    for (const pattern of signature.busy) {
      if (pattern.test(String(text))) return { kind: "working" };
    }
  }
  if (hasDialog(lines, signatures)) return { kind: "decision", question: dialogQuestion(lines) };
  const wall = wallFromText(text, wallSignatures(harness));
  if (wall) return { kind: "wall", wall };
  // After the dialog sweep, so a pane that asks a question while a shell of
  // its own runs still reads as an ask, not as work.
  if (hasRunningBackgroundShell(text)) return { kind: "working" };
  return composerKind(lines, cursorX, cursorY, signatures) ?? { kind: "waiting" };
}

/**
 * The composer state of a pane that is still WORKING, for the one question
 * the message queue asks about a busy agent: may text be typed into it now?
 *
 * A brain in a long turn never reaches an idle composer, so a worker's report
 * notice used to wait in the server's memory queue until the turn ended, and
 * the queue it unblocks stood still (probe-brain-worker-handover-message,
 * 2026-08-26). Claude Code and codex both accept typed text while they work
 * and read it at their next turn boundary, so the wait was never needed; what
 * is needed is proof that nothing is being composed.
 *
 * Returns "idle" (a recognized composer prompt with the cursor at its home
 * column), "draft" (the cursor has moved past the home column, so text is
 * being composed), or null when the pane shows a dialog or no composer this
 * module recognizes. Only "idle" is safe to type into; null and "draft" mean
 * queue, exactly as before.
 *
 * The cursor, not the composer text, decides. Codex paints gray placeholder
 * text after its prompt, and placeholder text never moves the cursor.
 */
export function classifyWorkingComposer({ text, cursorX = 0, cursorY = 0, harness = null }) {
  const lines = String(text ?? "").split("\n");
  const signatures = orderedSignatures(harness);
  if (hasDialog(lines, signatures) || wallFromText(text, wallSignatures(harness))) return null;
  return composerKind(lines, cursorX, cursorY, signatures)?.kind ?? null;
}

/** True when any harness's dialog signature is on screen. */
function hasDialog(lines, signatures = Object.values(PANE_SIGNATURES)) {
  for (const signature of signatures) {
    for (const pattern of signature.dialog) {
      if (lines.some((candidate) => pattern.test(candidate))) return true;
    }
  }
  return false;
}

/**
 * The composer classification of the cursor's own line, or null when the
 * cursor does not sit on a composer prompt this module recognizes.
 */
function composerKind(lines, cursorX, cursorY, signatures = Object.values(PANE_SIGNATURES)) {
  const cursorLine = lines[cursorY] ?? "";
  const composers = signatures.map((signature) => signature.composer);
  // A prompt character is the stronger evidence: claude boxes its `❯` line in
  // rules too, so the frame form is only consulted when no prompt matched.
  for (const { prompt, homeColumn } of composers) {
    if (prompt && prompt.test(cursorLine)) return cursorX <= homeColumn ? { kind: "idle" } : { kind: "draft" };
  }
  for (const { frame, homeColumn } of composers) {
    if (frame && isFramedComposer(lines, cursorY, frame)) return cursorX <= homeColumn ? { kind: "idle" } : { kind: "draft" };
  }
  return null;
}

/** Returns a captured wall fact, or null. */
export function wallFromText(text, signatures = Object.values(PANE_SIGNATURES)) {
  const lines = String(text ?? "").split("\n");
  const terminalLine = [...lines].reverse().find((line) => line.trim())?.trim() ?? "";
  for (const signature of signatures) {
    for (const entry of signature.wall ?? []) {
      const match = terminalLine.match(entry.pattern);
      if (!match) continue;
      return {
        pattern: entry.id,
        kind: entry.kind,
        model: entry.model && match[entry.model] ? String(match[entry.model]).trim() : null,
        text: terminalLine,
        source: "screen",
      };
    }
  }
  return null;
}

/** Uses the named family first and generic evidence second. */
function orderedSignatures(harness) {
  const family = harnessFamily(harness);
  if (!family || !PANE_SIGNATURES[family]) return Object.values(PANE_SIGNATURES);
  return [PANE_SIGNATURES[family], PANE_SIGNATURES.generic];
}

/** Uses only wall evidence owned by the exact named launch family. */
function wallSignatures(harness) {
  const family = harnessFamily(harness);
  return family && PANE_SIGNATURES[family] ? [PANE_SIGNATURES[family]] : [PANE_SIGNATURES.generic];
}

/** Maps registry harness names onto screen families. */
function harnessFamily(harness) {
  const value = String(harness ?? "").toLowerCase();
  if (value === "claude" || value === "claude-otto") return "claude";
  if (value === "codex" || value === "codex-gw") return "codex";
  if (value === "pi" || value.startsWith("pi-code")) return "pi";
  return value || null;
}

/**
 * True when the cursor line is the one line boxed between two rule lines: the
 * shape of a prompt-less editor such as pi's. Requires a rule directly above
 * and directly below so ordinary output that happens to contain a rule cannot
 * pass as a composer.
 */
function isFramedComposer(lines, cursorY, frame) {
  if (cursorY < 1 || cursorY + 1 >= lines.length) return false;
  return frame.test(lines[cursorY - 1]) && frame.test(lines[cursorY + 1]);
}

/**
 * Reads the harness's own context-fill readout from a pane capture. Runs
 * every family's `context.pattern` over the raw text, first match wins, and
 * returns the tokens used and the window size. Returns null when no pattern
 * matches, a number fails to parse, the window is not positive, or used
 * exceeds the window (an inverted parse must never remind a fresh session).
 * Null means unknown: callers must never remind, show, or change reminder
 * state on it.
 */
export function parseContextFill(text) {
  const value = String(text ?? "");
  for (const signature of Object.values(PANE_SIGNATURES)) {
    if (!signature.context) continue;
    const match = value.match(signature.context.pattern);
    if (!match) continue;
    const fill = signature.context.read(match);
    if (!Number.isFinite(fill.usedTokens) || !Number.isFinite(fill.windowTokens)) return null;
    if (fill.windowTokens <= 0 || fill.usedTokens > fill.windowTokens) return null;
    return fill;
  }
  return null;
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
