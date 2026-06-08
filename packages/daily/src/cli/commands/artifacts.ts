import { readFile } from "node:fs/promises";
import { openConvos } from "@convos/convos";

import { buildTurnDigestInput } from "../../convos/adapter.js";
import { loadConfig } from "../../core/config.js";
import { fallbackTopicRollup, groupTurnDigests } from "../../core/grouping.js";
import { hashObject } from "../../core/hash.js";
import { latestLedgerBySource, readLedger } from "../../core/ledger.js";
import { readDigestsForDate, writeDailyNote, writeTurnInputCache } from "../../core/note-writer.js";
import { renderDailyNote } from "../../core/renderer.js";
import { dateArgToBucket, todayBucket } from "../../core/time.js";
import type { DailyNote } from "../../types/daily-note.js";
import { dateArg, providerArg, stringArg, type Args } from "../args.js";

export async function inputCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const sourceKey = requiredSource(args);
  const dataset = await openConvos({ repo: loaded.repo.root, providers: providerArg(args.provider) ? [providerArg(args.provider)!] : loaded.config.input.providers });
  const turn = dataset.turns.get(sourceKey).data;
  if (!turn) throw new Error(`No turn found for ${sourceKey}.`);
  const date = dateArgToBucket(dateArg(args.date), loaded.config.processing.timezone) ||
    (turn.endedAt || turn.lastActivityAt).toISOString().slice(0, 10);
  const input = buildTurnDigestInput({ dataset, repo: loaded.repo, config: loaded.config, turn, dateBucket: date });
  const inputHash = hashObject(input);
  const path = await writeTurnInputCache({ loaded, input, inputHash });
  if (args.path) console.log(path);
  else console.log(JSON.stringify(input, null, 2));
}

export async function digestCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const sourceKey = requiredSource(args);
  const latest = latestLedgerBySource(await readLedger(loaded.paths.ledgerPath)).get(sourceKey);
  if (!latest?.digestPath) throw new Error(`No processed digest found for ${sourceKey}.`);
  const text = await readFile(latest.digestPath, "utf8");
  console.log(args.json ? JSON.stringify(JSON.parse(text), null, 2) : text.trim());
}

export async function topicsCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const date = dateArgToBucket(dateArg(args.date), loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  const digests = (await readDigestsForDate(loaded, date)).map((row) => row.digest);
  const topics = groupTurnDigests(digests).map((group) => fallbackTopicRollup(date, group));
  console.log(JSON.stringify(topics, null, 2));
}

export async function renderCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const date = dateArgToBucket(dateArg(args.date), loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  if (!args["dry-run"]) {
    const note = await writeDailyNote(loaded, date);
    if (args.json) console.log(JSON.stringify(note.model, null, 2));
    else console.log(note.path);
    return;
  }
  const digests = (await readDigestsForDate(loaded, date)).map((row) => row.digest);
  const topics = groupTurnDigests(digests).map((group) => fallbackTopicRollup(date, group));
  const model: DailyNote = {
    schema: "daily.note.v2",
    repo: {
      id: loaded.repo.id,
      name: loaded.config.repo?.displayName || loaded.repo.displayName,
      rootHash: loaded.repo.rootHash,
      branch: loaded.repo.branch
    },
    date,
    timezone: loaded.config.processing.timezone,
    generatedAt: new Date().toISOString(),
    source: {
      turnKeys: topics.flatMap((topic) => topic.sourceTurnKeys),
      providers: [...new Set(topics.flatMap((topic) => topic.providers))],
      topicKeys: topics.map((topic) => topic.key),
      dailyVersion: "0.2.0"
    },
    topics,
    sourceCaveats: [...new Set(topics.flatMap((topic) => topic.caveats))]
  };
  if (args.explain) console.error(JSON.stringify({ date, digests: digests.length, topics: topics.length }, null, 2));
  console.log(args.json ? JSON.stringify(model, null, 2) : renderDailyNote(model, loaded.config));
}

function requiredSource(args: Args): string {
  const source = stringArg(args.source);
  if (!source) throw new Error("--source is required.");
  return source;
}
