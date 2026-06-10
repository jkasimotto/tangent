import { readFile } from "node:fs/promises";
import { openUsage } from "@tangent/usage";

import { buildTurnDigestInput } from "../../usage/adapter.js";
import { loadConfig } from "../../core/config.js";
import { fallbackTopicRollup, groupTurnDigests } from "../../core/grouping.js";
import { hashObject } from "../../core/hash.js";
import { latestLedgerBySource, readLedger } from "../../core/ledger.js";
import {
  readRollupForKey,
  readDigestsForDate,
  writeRollupNote,
  writeGeneratedRollupMarkdown,
  writeTurnInputCache
} from "../../core/note-writer.js";
import { renderRollupNote } from "../../core/renderer.js";
import { dateArgToBucket, rollupPeriodArg, todayBucket } from "../../core/time.js";
import type { RollupNote } from "../../types/rollup-note.js";
import { dateArg, providerArg, stringArg, type Args } from "../args.js";

export async function inputCommand(args: Args): Promise<void> {
  const loaded = await loadConfig({ repo: args._[1] || "." });
  const sourceKey = requiredSource(args);
  const dataset = await openUsage({ repo: loaded.repo.root, providers: providerArg(args.provider) ? [providerArg(args.provider)!] : loaded.config.input.providers });
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
  const period = rollupPeriodArg(dateArg(args.date), loaded.config.processing.timezone);
  const rollup = await readRollupForKey(loaded, period.key);
  if (!args["dry-run"]) {
    if (rollup) {
      const note = await writeGeneratedRollupMarkdown(loaded, period, rollup.output.markdown);
      if (args.json) console.log(JSON.stringify(rollup.output, null, 2));
      else console.log(note.path);
      return;
    }
    const note = await writeRollupNote(loaded, period);
    if (args.json) console.log(JSON.stringify(note.model, null, 2));
    else console.log(note.path);
    return;
  }
  if (rollup) {
    if (args.explain) console.error(JSON.stringify({ period, rollup: rollup.path }, null, 2));
    console.log(args.json ? JSON.stringify(rollup.output, null, 2) : rollup.output.markdown.trim());
    return;
  }
  const digests = (await readDigestsForDate(loaded, period.startDate)).map((row) => row.digest);
  const topics = groupTurnDigests(digests).map((group) => fallbackTopicRollup(period.startDate, group));
  const model: RollupNote = {
    schema: "rollup.note.v1",
    repo: {
      id: loaded.repo.id,
      name: loaded.config.repo?.displayName || loaded.repo.displayName,
      rootHash: loaded.repo.rootHash,
      branch: loaded.repo.branch
    },
    period,
    timezone: loaded.config.processing.timezone,
    generatedAt: new Date().toISOString(),
    source: {
      turnKeys: topics.flatMap((topic) => topic.sourceTurnKeys),
      providers: [...new Set(topics.flatMap((topic) => topic.providers))],
      topicKeys: topics.map((topic) => topic.key),
      rollupVersion: "0.2.0"
    },
    topics,
    sourceCaveats: [...new Set(topics.flatMap((topic) => topic.caveats))]
  };
  if (args.explain) console.error(JSON.stringify({ period, digests: digests.length, topics: topics.length }, null, 2));
  console.log(args.json ? JSON.stringify(model, null, 2) : renderRollupNote(model, loaded.config));
}

function requiredSource(args: Args): string {
  const source = stringArg(args.source);
  if (!source) throw new Error("--source is required.");
  return source;
}
