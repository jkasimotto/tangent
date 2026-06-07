import { loadConfig } from "../../core/config.js";
import { readDigestsForDate } from "../../core/note-writer.js";
import { dateArgToBucket, todayBucket } from "../../core/time.js";
import { dateArg, type Args } from "../args.js";

export async function digestsCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const date = dateArgToBucket(dateArg(args.date), loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  const rows = await readDigestsForDate(loaded, date);
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(`No cached digests for ${date}.`);
    return;
  }
  for (const row of rows) console.log(`${row.digest.conversation.provider}  ${row.digest.conversation.id}  ${row.path}`);
}
