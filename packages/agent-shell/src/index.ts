// `@tangent/agent-shell` is the CLI surface of the Agent Shell: the vault CLI (`tangent area`,
// `tangent goal`, `tangent idea`, `tangent vault`), the agent messaging CLI (`tangent agent`),
// the pipeline CLI (`tangent goal start`, `tangent send`), and the study partner launcher
// (`tangent study`). Pipelines themselves are owned by the Agent Shell server in
// packages/agent-shell/app/; `tangent study` spawns its own local interactive session instead.
export * from "./cli/index.js";
