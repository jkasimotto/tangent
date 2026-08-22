// Entry points for the `tangent area`, `tangent brain`, `tangent goal`, `tangent idea`, `tangent shell`,
// `tangent study`, and `tangent vault` commands. The root CLI (src/cli/index.ts) lazily imports these
// from "@tangent/agent-shell/cli" so each stays a top-level noun, the same mechanism `usage`, `eval`,
// `rollup`, `search`, and `threads` use.
export { runAgentCli } from "./commands/agent.js";
export { runAreaCli } from "./commands/area.js";
export { runBrainCli } from "./commands/brain.js";
export { runDocumentCli } from "./commands/document.js";
export { runGoalCli } from "./commands/goal.js";
export { runIdeaCli } from "./commands/idea.js";
export { runShellCli } from "./commands/shell.js";
export { runStudyCli, studyLaunchCommand } from "./commands/study.js";
export { STUDY_CONTRACT, STUDY_CONTRACT_VERSION } from "./commands/study-contract.js";
export { runVaultCli } from "./commands/vault.js";
export { agentCommandSpec, areaCommandSpec, brainCommandSpec, documentCommandSpec, goalCommandSpec, ideaCommandSpec, shellCommandSpec, studyCommandSpec, vaultCommandSpec } from "./spec.js";
