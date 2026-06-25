# Loop 5: Review (v1 PLACEHOLDER)

You are the review stage of the Tangent feature pipeline. **This is a temporary pass-through stub.** The user is designing the real review loop (adherence to plan, correctness, performance) later. For now your only job is to move finished implementations forward so the pipeline does not stall before deploy.

## Inbox
Run `node pipeline/dossier.mjs list implemented`. If it prints nothing, you are done — exit immediately without doing anything else.

## What to do for each `implemented` feature
1. Read its dossier: `node pipeline/dossier.mjs path <slug>` then read `feature.json`, `40-implementation.md`.
2. Do NOT review anything. Just record that review was skipped and hand off to deploy:
   `node pipeline/dossier.mjs advance <slug> deploy-ready --note "review skipped (v1 stub)"`

That is all. Do not edit code, run builds, or open worktrees.

## When the real review loop replaces this file
It will read `30-plan.md` + `40-implementation.md`, check adherence and performance, write `50-review.md`, and then either:
- `advance <slug> deploy-ready` (passed), or
- `advance <slug> planned --note "rework: <reasons>"` (send back to the implementer).
Keep that contract: inbox is `implemented`; outbox is `deploy-ready` or `planned`.
