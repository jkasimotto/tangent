import { loadConfig } from "../core/config.js";
import { dateArgToBucket, todayBucket } from "../core/time.js";
import { readDailyNote } from "../core/note-writer.js";
import type { DailyNote } from "../types/daily-note.js";

export type GetDailyNoteOptions = {
  repo: string;
  date?: string;
};

export type DailyNoteReadResult = {
  path: string;
  markdown: string;
  model?: DailyNote;
  exists: boolean;
  stale: boolean;
};

export async function getDailyNote(options: GetDailyNoteOptions): Promise<DailyNoteReadResult> {
  const loaded = await loadConfig({ repo: options.repo });
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  return await readDailyNote(loaded, date);
}
