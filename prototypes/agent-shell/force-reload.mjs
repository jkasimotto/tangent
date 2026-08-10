#!/usr/bin/env node

const baseUrl = process.env.AGENT_SHELL_URL ?? "http://localhost:4321";

try {
  const response = await fetch(new URL("/api/reload", baseUrl), { method: "POST" });
  if (!response.ok) throw new Error(`server returned ${response.status}`);
  const result = await response.json();
  console.log(`Agent Shell reload sent to ${result.notified} window${result.notified === 1 ? "" : "s"}.`);
} catch (error) {
  console.error(`Agent Shell reload failed at ${baseUrl}: ${error.message ?? error}`);
  console.error("Start Agent Shell (or its server) and try again.");
  process.exitCode = 1;
}
