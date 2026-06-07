import { processUnprocessed } from "../../sdk/index.js";
import { booleanArg, dateArg, parseDate, providerArg, type Args } from "../args.js";

export async function processCommand(args: Args): Promise<void> {
  const result = await processUnprocessed({
    repo: args._[1] || ".",
    date: dateArg(args.date),
    from: parseDate(args.from),
    to: parseDate(args.to),
    provider: providerArg(args.provider),
    includeActive: booleanArg(args["include-active"])
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`processed: ${result.processed}`);
  console.log(`skipped:   ${result.skipped}`);
  console.log(`failed:    ${result.failed}`);
  console.log(`note:      ${result.note.path}`);
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
}
