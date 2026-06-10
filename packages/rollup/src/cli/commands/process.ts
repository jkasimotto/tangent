import { processRollup } from "../../sdk/index.js";
import { booleanArg, dateArg, providerArg, stringArg, stringsArg, type Args } from "../args.js";

const rollupKinds = ["daily-memory", "design-brief", "investigation-brief", "decision-log", "implementation-brief"] as const;
const rollupAudiences = ["self", "engineering-team", "future-agent"] as const;

type RollupKind = (typeof rollupKinds)[number];
type RollupAudience = (typeof rollupAudiences)[number];

export async function processCommand(args: Args): Promise<void> {
  const purpose = stringArg(args.purpose);
  const focus = stringsArg(args.focus);
  const title = stringArg(args.title);
  const kind = parseRollupKind(args.kind);
  const audience = parseRollupAudience(args.audience);
  const result = await processRollup({
    repo: args._[1] || ".",
    selector: stringArg(args.selector),
    date: dateArg(args.date),
    from: stringArg(args.from),
    to: stringArg(args.to),
    provider: providerArg(args.provider),
    force: booleanArg(args.force),
    dryRun: booleanArg(args["dry-run"]),
    purpose,
    focus,
    title,
    kind,
    audience,
    output: stringArg(args.output),
    filename: stringArg(args.filename),
    overwrite: booleanArg(args.overwrite)
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Rollup note: ${result.period.label}`);
  if (result.dryRun) {
    console.log(`Would process: ${result.candidates}`);
    console.log(`Note:          ${result.note.path}`);
    return;
  }
  if (result.providerStatus && !result.providerStatus.available) {
    console.log(`Summary provider unavailable: ${result.warnings[0]?.replace(/^Summary provider unavailable:\s*/, "") || "unknown"}`);
    console.log("Run: tangent rollup provider test");
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
      console.log(`     Try: tangent rollup retry --source ${failure.sourceKey}`);
    });
  }
  if (args.verbose) {
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  }
}

function parseRollupKind(value: unknown): RollupKind | undefined {
  if (value === undefined) return undefined;
  if (rollupKinds.includes(value as RollupKind)) return value as RollupKind;
  throw new Error(`--kind must be one of: ${rollupKinds.join(", ")}`);
}

function parseRollupAudience(value: unknown): RollupAudience | undefined {
  if (value === undefined) return undefined;
  if (rollupAudiences.includes(value as RollupAudience)) return value as RollupAudience;
  throw new Error(`--audience must be one of: ${rollupAudiences.join(", ")}`);
}
