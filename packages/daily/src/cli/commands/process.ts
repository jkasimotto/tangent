import { processUnprocessed } from "../../sdk/index.js";
import { booleanArg, dateArg, parseDate, providerArg, type Args } from "../args.js";

export async function processCommand(args: Args): Promise<void> {
  const result = await processUnprocessed({
    repo: args._[1] || ".",
    date: dateArg(args.date),
    from: parseDate(args.from),
    to: parseDate(args.to),
    provider: providerArg(args.provider),
    includeActive: booleanArg(args["include-active"]),
    dryRun: booleanArg(args["dry-run"])
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Daily note: ${result.date}`);
  if (result.dryRun) {
    console.log(`Would process: ${result.candidates}`);
    console.log(`Note:          ${result.note.path}`);
    return;
  }
  if (result.providerStatus && !result.providerStatus.available) {
    console.log(`Summary provider unavailable: ${result.warnings[0]?.replace(/^Summary provider unavailable:\s*/, "") || "unknown"}`);
    console.log("Run: tangent daily provider test");
    return;
  }
  console.log(`Processed: ${result.processed}`);
  console.log(`Skipped:   ${result.skipped}`);
  console.log(`Failed:    ${result.failed}`);
  console.log(`Note:      ${result.note.path}`);
  if (!result.note.updated && !result.note.created) console.log("");
  if (!result.note.updated && !result.note.created) console.log("No note updates were generated.");
  if (result.failures.length) {
    console.log("");
    console.log("Failures:");
    result.failures.forEach((failure, index) => {
      console.log(`  ${index + 1}. ${failure.sourceKey}  summary runner failed`);
      console.log(`     Reason: ${failure.reason}`);
      console.log(`     Details: ${failure.detailsPath}`);
      console.log(`     Try: tangent daily retry --source ${failure.sourceKey}`);
    });
  }
  if (args.verbose) {
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  }
}
