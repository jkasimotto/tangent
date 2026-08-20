// The rationale dossier contract a pipeline step's "When you finish" section
// carries (design contract: otto/tangent/design-learning-ai-written-code
// Decision 1, solution impl-rationale-dossier). A dossier is write-time
// memory: the two or three load-bearing pieces, the alternatives rejected
// and why, the invariants, and the blast radius, captured by the coding
// agent while the session is alive and cheap to ask. It costs Julian nothing
// and gates nothing: a missing dossier only degrades the study tutor back to
// today's reconstruction-and-inference behavior.

import path from "node:path";

/**
 * The vault-relative dossier path for one Goal file:
 * "otto/tangent/goal-x.md" -> "otto/tangent/rationale-x.md".
 */
export function rationaleDossierFile(goalFile) {
  const dir = path.posix.dirname(goalFile);
  const base = path.posix.basename(goalFile, ".md");
  const remainder = base.startsWith("goal-") ? base.slice("goal-".length) : base;
  return path.posix.join(dir, `rationale-${remainder}.md`);
}

/**
 * The dossier block of a pipeline step's "When you finish" section.
 * session may be "": the Generating session line then names the date
 * and repository only.
 */
export function rationaleDossierContract({ goalFile, title, area, treesRoot, session }) {
  const dossierFile = rationaleDossierFile(goalFile);
  const goalSlug = path.posix.basename(goalFile, ".md");
  const sessionLine = session
    ? `Generating session: ${session}, the repository path, and the date`
    : `Generating session: the repository path and the date`;
  return (
    `If this step changed code in a repository, write the rationale dossier before you hand over. The dossier records at write time what only this session knows; the study tutor later grades Julian's answers against it (design-learning-ai-written-code Decision 1). It costs Julian nothing and gates nothing.\n\n` +
    `Write ${treesRoot}/${dossierFile} with frontmatter \`type: document\` and \`status: note\`, the title \`# Rationale: ${title}\`, and a first line \`Goal: [[${goalSlug}]]. Commit <ids>, <date>. Written by the coding agent at Goal finish.\` Then state, in plain prose:\n\n` +
    `- Entry points touched, each with its callers.\n` +
    `- The two or three load-bearing pieces, and why each must exist.\n` +
    `- Alternatives you rejected, each with the reason.\n` +
    `- Invariants that must hold, each with the test that pins it when a test exists.\n` +
    `- Blast radius: what this change can break, and what stays untouched.\n\n` +
    `End with the line ${sessionLine}. State facts from this session only. Keep the body under 40 lines. If the file already exists, update it in place instead. Then commit it: \`tangent vault commit ${dossierFile} -m "add: ${area} rationale: <short title>"\` (verb \`update:\` when the file existed). If the dossier write or commit fails, hand over anyway and name the failure in your handover.`
  );
}
