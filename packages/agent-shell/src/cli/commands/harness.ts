import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, stringArg } from "@tangent/core/cli";

import { requireArea, resolveServerUrl, vaultFetch } from "../client.js";
import { harnessCommandSpec } from "../spec.js";

type Launch = {
  harness?: string;
  model?: string;
  effort?: string;
  label?: string;
  command?: string;
  error?: string;
};

type Effort = { id: string; label: string; args: string; command: string };
type Model = { id: string; label: string; args: string; command: string; efforts: Effort[] };
type Harness = { id: string; label: string; command: string; models: Model[]; efforts: Effort[] };
type HarnessCatalog = {
  source: string;
  area?: string;
  remembered?: Launch & { source?: string | null };
  policy?: { declaredBy?: string[]; unrestricted?: boolean; health?: string; contracts?: Array<{ area: string; state: string }>; allow?: Array<{ harness: string; model?: string; effort?: string }> };
  harnesses: Harness[];
};

/** Lists the launch catalog through the Agent Shell's existing resolution boundary. */
export async function runHarnessCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand !== "list") throw new Error(`Unknown harness command: ${subcommand}. Try "tangent harness --help".`);

  const server = resolveServerUrl(stringArg(args.server));
  const requestedArea = stringArg(args.area)?.trim();
  const area = requestedArea ? await requireArea(server, requestedArea) : "";
  const query = new URLSearchParams({ kind: "all", ...(area ? { area } : {}) });
  const catalog = await vaultFetch(server, `/api/launch/options?${query}`) as HarnessCatalog;
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }
  printCatalog(catalog);
}

/** Prints a compact catalog while preserving every id accepted by --launch. */
function printCatalog(catalog: HarnessCatalog): void {
  console.log(`source: ${catalog.source}`);
  if (catalog.area) {
    console.log(`policy: ${catalog.policy?.unrestricted ? "unrestricted" : (catalog.policy?.allow ?? []).map((ref) => [ref.harness, ref.model, ref.effort].filter(Boolean).join("/")).join(", ")}`);
    console.log(`declared by: ${catalog.policy?.declaredBy?.join(", ") || "none"}`);
    console.log(`contract: ${catalog.policy?.health ?? "unknown"}${catalog.policy?.contracts?.length ? ` (${catalog.policy.contracts.map((item) => `${item.area}: ${item.state}`).join(", ")})` : ""}`);
    console.log(`remembered: ${launchLine(catalog.remembered)}${catalog.remembered?.source ? ` from ${catalog.remembered.source}` : ""}`);
  }
  for (const harness of catalog.harnesses) {
    console.log(`\n${harness.id} (${harness.label})`);
    console.log(`  command: ${harness.command}`);
    if (harness.efforts.length) console.log(`  efforts: ${harness.efforts.map((effort) => effort.id).join(", ")}`);
    for (const model of harness.models) {
      console.log(`  ${model.id}: ${model.command}`);
      if (model.efforts.length) console.log(`    efforts: ${model.efforts.map((effort) => effort.id).join(", ")}`);
      for (const effort of model.efforts) console.log(`    ${model.id}/${effort.id}: ${effort.command}`);
    }
  }
}

/** Formats one resolved default without substituting a guessed launch. */
function launchLine(launch: Launch | undefined): string {
  if (!launch) return "not declared";
  if (launch.error) return `error: ${launch.error}`;
  const ref = [launch.harness, launch.model, launch.effort].filter(Boolean).join("/");
  return `${ref || "not declared"}${launch.label ? ` (${launch.label})` : ""}${launch.command ? ` — ${launch.command}` : ""}`;
}

/** Prints help generated from the same spec that defines accepted options. */
function help(): void {
  console.log(renderCommandHelp(harnessCommandSpec));
  console.log(`
Examples:
  tangent harness list
  tangent harness list --area otto/tangent
  tangent harness list --area otto/tangent --json
`);
}
