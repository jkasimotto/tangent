import { loadConfig } from "../core/config.js";
import { rollupPeriodArg } from "../core/time.js";
import { readRollupNote } from "../core/note-writer.js";

export type GetRollupNoteOptions = {
  repo: string;
  selector?: string;
  date?: string;
};

export type RollupNoteReadResult = {
  path: string;
  markdown: string;
  exists: boolean;
  stale: boolean;
};

export async function getRollupNote(options: GetRollupNoteOptions): Promise<RollupNoteReadResult> {
  const loaded = await loadConfig({ repo: options.repo });
  const period = rollupPeriodArg(options.selector || options.date, loaded.config.processing.timezone);
  return await readRollupNote(loaded, period);
}
