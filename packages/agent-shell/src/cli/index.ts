// Entry points for the `tangent area`, `tangent goal`, `tangent idea`, and `tangent vault`
// commands. The root CLI (src/cli/index.ts) lazily imports these from "@tangent/agent-shell/cli"
// so each stays a top-level noun, the same mechanism `usage`, `eval`, `rollup`, `search`, and
// `threads` use.
export { runAgentCli } from "./commands/agent.js";
export { runAreaCli } from "./commands/area.js";
export { runDocumentCli } from "./commands/document.js";
export { runGoalCli } from "./commands/goal.js";
export { runIdeaCli } from "./commands/idea.js";
export { runVaultCli } from "./commands/vault.js";
export { agentCommandSpec, areaCommandSpec, documentCommandSpec, goalCommandSpec, ideaCommandSpec, vaultCommandSpec } from "./spec.js";
