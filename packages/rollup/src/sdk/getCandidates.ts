import { loadConfig } from "../core/config.js";
import { dateArgToBucket } from "../core/time.js";
import { collectCandidates, type CandidateConversation, type CandidateQuery } from "../usage/selectors.js";

export type GetCandidatesOptions = CandidateQuery;
export type { CandidateConversation } from "../usage/selectors.js";

/** Returns the list of candidate conversations for rollup processing matching the given query. */
export async function getCandidates(options: GetCandidatesOptions): Promise<CandidateConversation[]> {
  const loaded = await loadConfig({ repo: options.repo });
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone);
  const rows = await collectCandidates(loaded, { ...options, date });
  return rows.map(({ turn: _turn, ...row }) => row);
}
