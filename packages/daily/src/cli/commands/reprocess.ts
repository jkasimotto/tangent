import { processUnprocessed } from "../../sdk/index.js";
import { dateArg, providerArg, stringArg, type Args } from "../args.js";

export async function reprocessCommand(args: Args): Promise<void> {
  const result = await processUnprocessed({
    repo: args._[1] || ".",
    date: dateArg(args.date),
    provider: providerArg(args.provider),
    sourceKey: stringArg(args.source),
    force: Boolean(args.all || args.source || args.date)
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`reprocessed: ${result.processed}`);
    console.log(`failed:      ${result.failed}`);
    console.log(`note:        ${result.note.path}`);
  }
}
