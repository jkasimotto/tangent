# Validation

Use the narrowest useful validation first, then broaden before handoff.

Common commands:
- npm run check
- npm run test
- npm run governance
- npm run build

For architecture work:
- npm run governance
- npm run check
- npm run test --workspaces --if-present

When a command fails, keep the failure output and either fix it or record the blocker in the final response.
