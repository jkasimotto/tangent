import assert from "node:assert/strict";
import test from "node:test";

import { createUsageUiClient } from "../dist/index.js";

test("maps usage sessions into list view models", async () => {
  const client = createUsageUiClient({
    sessions: {
      /** Lists list. */
      list: async () => ({
        data: [{
          id: "s1",
          provider: "codex",
          title: "Implement UI",
          models: ["gpt"],
          metrics: { tokens: { total: 10 }, durationMs: 25 },
          counts: { toolCalls: 2 },
          availability: { notes: ["partial"] }
        }],
        meta: { warnings: [] }
      })
    }
  });
  const view = await client.listSessions();
  assert.equal(view.sessions[0].title, "Implement UI");
  assert.equal(view.sessions[0].tokensTotal, 10);
});
