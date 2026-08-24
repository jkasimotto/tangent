#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { withAssigneesFrontmatter, withPeopleSection } from "../packages/agent-shell/app/human-assignees.mjs";

const plannedRules = Array.from({ length: 10 }, (_, index) => {
  const rule = 40 + index;
  return {
    file: `neara/pgande/standards/goal-plan-refactor-pgande-module-rule-${rule}.md`,
    owner: `Owner: TBD, planned by GLM 5.2 agents once the architecture goal is approved.`,
    replacement: `Planned by GLM 5.2 agents once the architecture goal is approved.`,
    assignees: [],
  };
});

/** Exact source clauses prevent this one-time migration from guessing at prose. */
export const goalManifest = [
  { file: "neara/onboarding/goal-build-the-embedded-js-onboarding-walkthrough-app.md", owner: "Owner: Julian, executed by an agent.", replacement: "Executed by an agent.", assignees: ["Julian"] },
  { file: "neara/pgande/benchmarking/goal-show-force-difference-model-pole-vs-o-calc-pldb.md", owner: "Owner: Troy.", replacement: "", assignees: ["Troy"] },
  { file: "neara/pgande/benchmarking/goal-pldb-mutation-mismatch-plain-diff-check.md", owner: "Owner: Troy.", replacement: "", assignees: ["Troy"] },
  { file: "neara/pgande/benchmarking/goal-benchmark-poles-against-o-calc-pldb-forces.md", owner: "Owner: Rit.", replacement: "", assignees: ["Rit"] },
  { file: "neara/pgande/dashboards/goal-scope-dashboard-metrics.md", owner: "Owner: TBD.", replacement: "", assignees: [] },
  { file: "neara/pgande/autodesign/goal-pole-diff-define-what-it-actually-is.md", owner: "Owner: TBD.", replacement: "", assignees: [] },
  { file: "neara/pgande/autodesign/goal-guy-clearances-scope-what-they-are-and-how-work.md", owner: "Owner: TBD (not yet assigned).", replacement: "", assignees: [] },
  { file: "neara/pgande/autodesign/goal-suppress-checks-and-remediations-per-element.md", owner: "Owner: TBD.", replacement: "", assignees: [] },
  { file: "neara/pgande/autodesign/goal-decide-reframe-autodesign-remediation-to-consume.md", owner: "Owner: Julian (decision), then TBD (implementation).", replacement: "Julian owned the completed decision. The conditional implementation has no assignee because it does not exist.", assignees: ["Julian"] },
  { file: "neara/pgande/autodesign/goal-improved-drill-down-find-dan-s-branch.md", owner: "Owner: Dan, Brida.", replacement: "", assignees: ["Dan", "Brida"] },
  { file: "neara/pgande/autodesign/goal-julian-understand-the-existing-autodesign-code.md", owner: "Owner: Julian.", replacement: "", assignees: ["Julian"] },
  { file: "neara/pgande/megabranch/goal-julian-land-cad-tooling-snap-points.md", owner: "Owner: Julian.", replacement: "", assignees: ["Julian"] },
  { file: "neara/pgande/megabranch/goal-will-land-his-stuff.md", owner: "Owner: Will.", replacement: "", assignees: ["Will"] },
  ...plannedRules,
  { file: "neara/pgande/standards/goal-standards-architecture-names-shapes-and-ownershi.md", owner: "Owner: Julian approves; GLM 5.2 agents do the work.", replacement: "Julian approves the result. GLM 5.2 agents do the work.", assignees: ["Julian"] },
  { file: "neara/pgande/standards/goal-standards-customer-overrides.md", owner: "Owner: Julian reviews; Fable agents do the work, starting now.", replacement: "Julian reviews the result. Fable agents do the work, starting now.", assignees: ["Julian"] },
];

export const rosterManifest = [
  { file: "neara/pgande/pgande.md", people: ["Troy", "Rit", "Dan", "Brida", "Will", "Sahan", "Sami", "Julian"] },
  { file: "neara/onboarding/onboarding.md", people: ["Julian"] },
];

/** Applies one manifest entry or recognizes its exact migrated state. */
export function migrateGoalText(text, entry) {
  const expectedField = `assignees: [${entry.assignees.join(", ")}]`;
  if (!text.includes(entry.owner)) {
    if (text.includes(expectedField) && !/^Owner:/m.test(text)) return { text, changed: false };
    throw new Error(`${entry.file}: expected owner clause not found`);
  }
  if ((text.match(new RegExp(entry.owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) {
    throw new Error(`${entry.file}: owner clause is not unique`);
  }
  const replaced = text.replace(entry.owner, entry.replacement).replace(/\n{3,}/g, "\n\n");
  return { text: withAssigneesFrontmatter(replaced, entry.assignees), changed: true };
}

/** Runs the explicit migration against one vault root. */
export async function migrateNeara(treesRoot, { write = false } = {}) {
  const changes = [];
  for (const entry of goalManifest) {
    const absolute = path.join(treesRoot, entry.file);
    const current = await readFile(absolute, "utf8");
    const result = migrateGoalText(current, entry);
    if (result.changed) {
      changes.push({ file: entry.file, owner: entry.owner, assignees: entry.assignees });
      if (write) await writeFile(absolute, result.text, "utf8");
    }
  }
  for (const entry of rosterManifest) {
    const absolute = path.join(treesRoot, entry.file);
    const current = await readFile(absolute, "utf8");
    let next = withPeopleSection(current, entry.people);
    if (entry.file.endsWith("pgande.md")) next = next.replace(/Named by Julian[^\n]*\n\n/, "");
    if (next !== current) {
      changes.push({ file: entry.file, people: entry.people });
      if (write) await writeFile(absolute, next, "utf8");
    }
  }
  return changes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const rootIndex = process.argv.indexOf("--trees");
  const treesRoot = rootIndex >= 0 ? process.argv[rootIndex + 1] : path.join(process.env.HOME, ".tangent", "trees");
  const write = process.argv.includes("--write");
  const changes = await migrateNeara(treesRoot, { write });
  console.log(`${write ? "Migrated" : "Dry run"}: ${changes.length} files change.`);
  for (const change of changes) console.log(`${change.file}: ${change.assignees ? `[${change.assignees.join(", ")}]` : change.people.join(", ")}`);
}
