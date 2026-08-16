// `@tangent/agent-shell` is the CLI surface of the Agent Shell: the vault CLI (`tangent area`,
// `tangent goal`, `tangent idea`, `tangent vault`), the agent messaging CLI (`tangent agent`),
// and the pipeline CLI (`tangent goal start`, `tangent goal handover`). Pipelines themselves are
// owned by the Agent Shell server in prototypes/agent-shell/.
export * from "./cli/index.js";
