import { status } from "../../sdk/index.js";
import type { Args } from "../args.js";

export async function statusCommand(args: Args): Promise<void> {
  const value = await status({ repo: args._[1] || ".", date: typeof args.date === "string" ? args.date : undefined });
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`rollup status - ${value.repo.root}`);
  console.log("");
  console.log("Usage");
  for (const [provider, row] of Object.entries(value.usage.providers)) {
    const label = provider === "claude" ? "Claude" : "Codex";
    console.log(`  ${label}: ${row.tracked ? "tracked" : "not tracked"}, ${row.turns} turns${row.lastTurnAt ? `, last ${row.lastTurnAt}` : ""}`);
  }
  console.log("");
  console.log("Rollup");
  console.log(`  initialized: ${value.rollup.initialized ? "yes" : "no"}`);
  console.log(`  output:      ${value.rollup.outputDir}`);
  console.log(`  note today:  ${value.notes[0]?.path || "(none)"}`);
  console.log(`  ledger:      ${value.rollup.ledgerPath}`);
  console.log("");
  console.log("Summary provider");
  console.log(`  kind:        ${value.summaryProvider.kind}`);
  console.log(`  model:       ${value.summaryProvider.model || "(default)"}`);
  console.log(`  available:   ${value.summaryProvider.available ? "yes" : "no"}`);
  for (const warning of value.summaryProvider.warnings) console.log(`  warning:     ${warning}`);
  console.log("");
  console.log("Candidates");
  console.log(`  total:       ${value.candidates.total}`);
  for (const [provider, count] of Object.entries(value.candidates.byProvider)) console.log(`  ${provider}:      ${count}`);
  if (Object.keys(value.candidates.byDate).length) {
    console.log("  dates:");
    for (const [date, count] of Object.entries(value.candidates.byDate)) console.log(`    ${date}: ${count}`);
  }
}
