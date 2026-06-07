import { getUnprocessed } from "../../sdk/index.js";
import { booleanArg, dateArg, parseDate, providerArg, type Args } from "../args.js";

export async function unprocessedCommand(args: Args): Promise<void> {
  const rows = await getUnprocessed({
    repo: args._[1] || ".",
    date: dateArg(args.date),
    from: parseDate(args.from),
    to: parseDate(args.to),
    providers: providerArg(args.provider) ? [providerArg(args.provider)!] : undefined,
    includeActive: booleanArg(args["include-active"])
  });
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("No unprocessed conversations.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.dateBucket}  ${row.provider}  ${row.reason}  ${row.conversationId}${row.title ? `  ${row.title}` : ""}`);
  }
}
