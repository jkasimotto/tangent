import type http from "node:http";

import type { UiRouteResponse } from "@tangent/ui-server";

/** Sends a JSON route response. */
export function json(status: number, value: unknown): UiRouteResponse {
  return { status, json: value };
}

/** Reads an optional string query parameter. */
export function stringParam(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) || undefined;
}

/** Reads an optional numeric query parameter. */
export function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads and parses a JSON request body, returning an empty object for an empty body. */
export async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

/** Reads a required string field off a parsed JSON body, throwing a 400-mapped error when missing. */
export function requiredBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value === "string" && value) return value;
  const error = new Error(`${key} is required.`) as Error & { status?: number };
  error.status = 400;
  throw error;
}

/** Reads an optional string field off a parsed JSON body. */
export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value ? value : undefined;
}

/** Reads an optional numeric field off a parsed JSON body. */
export function numberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
