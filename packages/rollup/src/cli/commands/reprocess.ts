import { processRollup } from "../../sdk/index.js";
import { dateArg, providerArg, stringArg, type Args } from "../args.js";

/** Re-runs rollup processing for the given period or source and prints results. */
export async function reprocessCommand(args: Args): Promise<void> {
  const result = await processRollup({
    repo: args._[1] || ".",
    date: dateArg(args.date),
    provider: providerArg(args.provider),
    sourceKey: stringArg(args.source),
    force: Boolean(args.all || args.source || args.date)
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Rollup note:  ${result.period.label}`);
    console.log(`Reprocessed: ${result.processed}`);
    console.log(`Failed:      ${result.failed}`);
    console.log(`Note:        ${result.note.path}`);
    if (result.failures.length) {
      console.log("");
      console.log("Failures:");
      result.failures.forEach((failure, index) => {
        console.log(`  ${index + 1}. ${failure.sourceKey}  ${failure.reason}`);
        console.log(`     Details: ${failure.detailsPath}`);
      });
    }
  }
}
