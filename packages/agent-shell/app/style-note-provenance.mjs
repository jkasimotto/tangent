// Provenance for one style note (design-record D7 and D8).
//
// Two facts are recorded, and they are not the same person. The observer is the
// session that filed the note. The author is whoever wrote the bad sentence,
// and that is the fact worth having: an observation with no attribution cannot
// tell you which model writes badly.
//
// The author is resolved best effort through facts the vault already carries:
// every vault commit writes a `Tangent-Tmux` trailer (vault-repository.mjs), and
// a session name resolves to a harness, model, and effort through the durable
// brain and queue records (agent-context.mjs). Any step can fail, and when one
// does the entry says which; nothing is guessed.
//
// D8 resolves all of this at write time. Job records get pruned and session
// names get reused, so a corpus that resolved provenance at read time would
// decay exactly as it became valuable.

/** Collapses whitespace so a quote typed by hand still matches the file. */
function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** The nearest Markdown heading above one line, without its hashes, or null. */
export function headingAbove(lines, line) {
  for (let index = Math.min(line, lines.length - 1); index >= 0; index -= 1) {
    const match = /^#{1,6}\s+(.+)$/.exec(lines[index] ?? "");
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Where the annotated words stand in the current file, or null when they are
 * gone. The line is only a locator for `git blame`; `quote.text` is the field
 * the corpus actually depends on, so a miss is not a failure.
 */
export function findQuoteLine(text, quote) {
  const wanted = compact(quote);
  if (!wanted) return null;
  const lines = String(text ?? "").split("\n");
  const exact = lines.findIndex((line) => line.includes(wanted));
  const line = exact >= 0 ? exact : lines.findIndex((item) => compact(item).includes(wanted));
  if (line < 0) return null;
  return { line, heading: headingAbove(lines, line) };
}

/**
 * The harness facts of one resolved agent context. A brain carries them on its
 * generation as `resolvedLaunch`; a queue worker carries them on its assignment
 * as `launch`. Both shapes are `{ harness, model, effort }`.
 */
export function launchFromAgentContext(context) {
  if (!context) return null;
  const launch = context.role === "brain" ? context.brain?.attempt?.resolvedLaunch : context.assignment?.launch;
  if (!launch) return null;
  const harness = String(launch.harness ?? "").trim();
  const model = String(launch.model ?? "").trim();
  const effort = String(launch.effort ?? "").trim();
  return harness || model || effort ? { harness: harness || null, model: model || null, effort: effort || null } : null;
}

/**
 * The observer record for one caller. A request with no session header is
 * Julian in the reader; a brain session is a brain; any other named session is
 * an agent, which is honest about not being Julian rather than claiming to be.
 */
export function observerFor(actor, launch) {
  const session = String(actor?.session ?? "").trim();
  const kind = actor?.role === "brain" ? "brain" : session ? "agent" : "julian";
  return {
    kind,
    session: session || null,
    area: String(actor?.area ?? "").trim() || null,
    harness: launch?.harness ?? null,
    model: launch?.model ?? null,
    effort: launch?.effort ?? null,
  };
}

/** The commit sha of one `git blame --porcelain` answer, or null. */
export function blameCommit(stdout) {
  const first = String(stdout ?? "").split("\n")[0] ?? "";
  const match = /^([0-9a-f]{7,40})\s/.exec(first.trim());
  return match && !/^0+$/.test(match[1]) ? match[1] : null;
}

/** The `Tangent-Tmux` value of one commit, or an empty string when it has none. */
export function trailerSession(stdout) {
  return String(stdout ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/**
 * Who wrote the words at `line` of `file`, resolved through blame, the vault
 * commit trailer, and the durable session records. Returns the entry's whole
 * `author` shape, with `source` naming the step that failed when one did.
 *
 * `runGit` is injected so the resolution is testable without a repository, and
 * `launchForSession` stays the server's own authority over session identity.
 */
export async function resolveNoteAuthor({ runGit, root, file, line, launchForSession }) {
  if (!Number.isInteger(line)) return { source: "quote-not-found" };
  const blame = await runGit(["-C", root, "blame", "-L", `${line + 1},${line + 1}`, "--porcelain", "--", file]).catch(() => null);
  const commit = blameCommit(blame?.stdout ?? blame);
  if (!commit) return { source: "no-blame" };
  const show = await runGit(["-C", root, "show", "-s", "--format=%(trailers:key=Tangent-Tmux,valueonly)", commit]).catch(() => null);
  const session = trailerSession(show?.stdout ?? show);
  if (!session) return { source: "no-trailer", commit };
  const launch = await launchForSession(session);
  if (!launch) return { source: "unknown-session", commit, session };
  return { source: "blame-trailer", commit, session, ...launch };
}

/** The vault `HEAD` when the note was written, so a harvest can read the text back out of git. */
export async function vaultHead({ runGit, root }) {
  const result = await runGit(["-C", root, "rev-parse", "HEAD"]).catch(() => null);
  const head = String(result?.stdout ?? result ?? "").trim();
  return /^[0-9a-f]{7,40}$/.test(head) ? head : null;
}
