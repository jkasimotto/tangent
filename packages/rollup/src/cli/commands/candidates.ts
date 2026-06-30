import { getCandidates } from "../../sdk/index.js";
import { booleanArg, dateArg, parseDate, providerArg, type Args } from "../args.js";

/** Lists candidate conversations eligible for rollup processing. */
export async function candidatesCommand(args: Args): Promise<void> {
  const started = Date.now();
  const rows = await getCandidates({
    repo: args._[1] || ".",
    date: dateArg(args.date),
    from: parseDate(args.from),
    to: parseDate(args.to),
    providers: providerArg(args.provider) ? [providerArg(args.provider)!] : undefined,
    force: booleanArg(args.force)
  });
  if (args.json) {
    console.log(JSON.stringify(args.trace ? { rows, trace: { candidateQueryMs: Date.now() - started, rows: rows.length } } : rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("No candidate turns.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.dateBucket}  ${row.provider}  ${row.reason}  ${row.sourceKey}${row.titlePreview ? `  ${row.titlePreview}` : ""}`);
  }
  if (args.trace) console.log(JSON.stringify({ candidateQueryMs: Date.now() - started, rows: rows.length }, null, 2));
}
