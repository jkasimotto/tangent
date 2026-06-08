import { status } from "../../sdk/index.js";
import type { Args } from "../args.js";

export async function statusCommand(args: Args): Promise<void> {
  const value = await status({ repo: args._[1] || ".", date: typeof args.date === "string" ? args.date : undefined });
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`daily status - ${value.repo.root}`);
  console.log("");
  console.log("Convos");
  for (const [provider, row] of Object.entries(value.convos.providers)) {
    const label = provider === "claude" ? "Claude" : "Codex";
    console.log(`  ${label}: ${row.tracked ? "tracked" : "not tracked"}, ${row.turns} turns${row.lastTurnAt ? `, last ${row.lastTurnAt}` : ""}`);
  }
  console.log("");
  console.log("Daily");
  console.log(`  initialized: ${value.daily.initialized ? "yes" : "no"}`);
  console.log(`  output:      ${value.daily.outputDir}`);
  console.log(`  note today:  ${value.notes[0]?.path || "(none)"}`);
  console.log(`  ledger:      ${value.daily.ledgerPath}`);
  console.log("");
  console.log("Summary provider");
  console.log(`  kind:        ${value.summaryProvider.kind}`);
  console.log(`  model:       ${value.summaryProvider.model || "(default)"}`);
  console.log(`  available:   ${value.summaryProvider.available ? "yes" : "no"}`);
  for (const warning of value.summaryProvider.warnings) console.log(`  warning:     ${warning}`);
  console.log("");
  console.log("Unprocessed");
  console.log(`  total:       ${value.unprocessed.total}`);
  for (const [provider, count] of Object.entries(value.unprocessed.byProvider)) console.log(`  ${provider}:      ${count}`);
  if (Object.keys(value.unprocessed.byDate).length) {
    console.log("  dates:");
    for (const [date, count] of Object.entries(value.unprocessed.byDate)) console.log(`    ${date}: ${count}`);
  }
}
