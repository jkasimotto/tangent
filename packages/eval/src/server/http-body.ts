// A single helper shared by every route module that reads a JSON request body (server/index.ts,
// server/marks-routes.ts). Split out on its own so route modules can import it from each other without a
// circular dependency back through server/index.ts.

import type http from "node:http";

/** Reads and parses a JSON request body, returning an empty object for an empty body. */
export async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}
