import { loadConfig } from "../core/config.js";
import { dateArgToBucket } from "../core/time.js";
import { collectUnprocessed, type UnprocessedConversation, type UnprocessedConversationQuery } from "../convos/selectors.js";

export type GetUnprocessedOptions = UnprocessedConversationQuery;
export type { UnprocessedConversation } from "../convos/selectors.js";

export async function getUnprocessed(options: GetUnprocessedOptions): Promise<UnprocessedConversation[]> {
  const loaded = await loadConfig({ repo: options.repo });
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone);
  const rows = await collectUnprocessed(loaded, { ...options, date });
  return rows.map(({ envelope: _envelope, input: _input, eventHighWatermark: _eventHighWatermark, ...row }) => row);
}
