// Entry points for the Agent Shell command nouns. The root CLI (src/cli/index.ts) lazily imports these
// from "@tangent/agent-shell/cli" so each stays a top-level noun, the same mechanism `usage`, `eval`,
// `rollup` and `search` use.
export { runAgentCli } from "./commands/agent.js";
export { runAreaCli } from "./commands/area.js";
export { runBrainCli } from "./commands/brain.js";
export { runDocumentCli } from "./commands/document.js";
export { runGoalCli } from "./commands/goal.js";
export { runHarnessCli } from "./commands/harness.js";
export { runIdeaCli } from "./commands/idea.js";
export { runProcessCli } from "./commands/process.js";
export { runSendCli } from "./commands/send.js";
export { runShellCli } from "./commands/shell.js";
export { runStudyCli, studyLaunchCommand } from "./commands/study.js";
export { STUDY_CONTRACT, STUDY_CONTRACT_VERSION } from "./commands/study-contract.js";
export { runVaultCli } from "./commands/vault.js";
export { WORKER_MUTATION_REFUSAL } from "./client.js";
export { agentCommandSpec, areaCommandSpec, brainCommandSpec, documentCommandSpec, goalCommandSpec, harnessCommandSpec, ideaCommandSpec, processCommandSpec, sendCommandSpec, shellCommandSpec, studyCommandSpec, vaultCommandSpec } from "./spec.js";
