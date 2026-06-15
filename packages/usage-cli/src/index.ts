#!/usr/bin/env node

export const usageCliPackage = "@tangent/usage-cli";

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Usage CLI package scaffold. Use @tangent/usage/cli for the current command implementation during migration.");
}
