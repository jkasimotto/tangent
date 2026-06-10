import { loadConfig } from "../../core/config.js";
import { readRollupForKey, writeGeneratedRollupMarkdown } from "../../core/note-writer.js";
import { rollupPeriodArg } from "../../core/time.js";
import { dateArg, type Args } from "../args.js";

export async function renderCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const period = rollupPeriodArg(dateArg(args.date), loaded.config.processing.timezone);
  const rollup = await readRollupForKey(loaded, period.key);
  if (!rollup) throw new Error(`No period rollup exists for ${period.label}; run tangent rollup ${period.key}.`);

  if (args.explain) console.error(JSON.stringify({ period, rollup: rollup.path }, null, 2));
  if (args["dry-run"]) {
    console.log(args.json ? JSON.stringify(rollup.output, null, 2) : rollup.output.markdown.trim());
    return;
  }

  const note = await writeGeneratedRollupMarkdown(loaded, period, rollup.output.markdown);
  if (args.json) console.log(JSON.stringify(rollup.output, null, 2));
  else console.log(note.path);
}
