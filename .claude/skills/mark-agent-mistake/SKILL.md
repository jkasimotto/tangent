---
name: mark-agent-mistake
description: "WHEN TO USE: invoke when the user wants to capture a moment this agent session just misbehaved, typically by typing /mark or a short note like /mark you should have read the docs index first. Also triggers on plain requests to log or capture an agent mistake from the current conversation (\"mark this\", \"log that failure\", \"capture what just happened\"). This is the mark loop's primary capture surface: a fast, in-session note that becomes a tangent.mark.v1 record and, later, a proving eval. Do not invoke for generic bug reports unrelated to this agent's own behavior, and do not invoke to set up or run an eval directly (use setup-tangent-eval for that)."
---

# Mark an agent mistake

You just did something the user did not like, and they are telling you now, while it is fresh. Your job is to capture it in under a minute, propose a fix, and get out of the way. Capture first. Never block on perfect wording: a rough mark filed now beats a polished one filed never.

No em dashes in anything you write here: not in the mark's text, not in your replies.

## 1. Identify the moment

Look back over this conversation for the turn the user is reacting to. Quote the offending behavior verbatim (a command you ran, a sentence you wrote, a file you should have read but did not). If the user's message already points at a specific turn, use that one; otherwise use the most recent turn that plausibly caused the annoyance.

## 2. State observed and expected

Draft, from your own context:
- `observed`: what you actually did, in one sentence.
- `expected`: what you should have done instead, in one sentence.

If the user's free text already says both clearly, use it and move on. Confirm with the user in one exchange only when their text is thin (e.g. just "/mark that was wrong"): ask one short question, take the answer, and proceed. Do not turn this into a multi-turn interview.

## 3. Answer "what did I not know?"

Inspect the CLAUDE.md and skill files that were actually loaded into your context for this conversation (root CLAUDE.md, package-level CLAUDE.md files, any skill SKILL.md you read). Check whether the missing information already exists somewhere in those files:

- If it exists but you missed or misapplied it, say so plainly: the fix is not a new rule, it is making the existing one impossible to miss.
- If it genuinely does not exist anywhere in context, that is the gap. Write a one-sentence `hypothesis`: what you did not know, and where it should have lived.

## 4. Resolve the session

Prefer letting `tangent mark` resolve the cwd's newest transcript itself: do not pass `--session` by default. Only pass `--session <id>` when the user says the mark is about an older session, a different repo, or a conversation you are not currently in.

## 5. Persist the mark

Call `tangent mark --json` with the full record on stdin. This is the schema (`tangent.mark.v1`, from `packages/eval/src/marks/types.ts`):

```json
{
  "observed": "what happened, one sentence",
  "expected": "what should have happened, one sentence",
  "hypothesis": "what the agent did not know, and where it should have lived",
  "quote": "verbatim excerpt of the offending turn",
  "kind": "failure"
}
```

Only `observed` is required; everything else is optional but you should always be able to fill `expected`, `hypothesis`, and `quote` from steps 1 to 3. Leave out `anchor`, `repo`, `id`, `at`, `status`, and `links`: the CLI fills all of those from the current session and cwd. Use `kind: "candidate"` instead of `"failure"` only if the user is mining an efficiency exemplar rather than reporting a quality problem; default to `"failure"`.

Run it like this (adjust the JSON to your drafted fields):

```bash
echo '{"observed": "...", "expected": "...", "hypothesis": "...", "quote": "..."}' | tangent mark --json
```

The command prints the mark id. Read it back to yourself; you will need it in step 7.

## 6. Propose the fix, offer to apply it

State the concrete context fix: a CLAUDE.md edit, a new AGENTS.md line, a skill patch, whatever step 3 pointed at. Show the user the exact diff or text you would add. Offer to apply it. Never apply it without an explicit yes: this is a human-confirmed edit, not an automatic one.

Before actually applying the fix, ask whether the user wants the proving eval (step 7). If yes, capture the `baseline` context snapshot first: the baseline must reflect the context as it was before the fix, and once the fix is applied the unfixed state is gone. Order: capture baseline, apply fix, capture fixed.

## 7. Offer the eval

After the mark is saved (and the fix applied, if the user said yes), tell the user:

```bash
tangent mark to-eval <mark id>
```

Explain in one line what it does: it scaffolds `evals/<slug>/eval.json` and `prompts/task.md` in the mark's repo, with two variants, `baseline` and `fixed`, each pointing at a context snapshot. Explain the capture order plainly: capture the `baseline` snapshot with `tangent eval context capture` before applying the fix (or right now, if you have not applied it yet), apply the fix, then capture the `fixed` snapshot after. Running the eval before both snapshots exist will fail; that is expected, not a bug to chase.

End by printing the mark id and the two follow-up commands, so the trail back is one paste away:

```
mark: <id>
Follow up:  tangent mark show <id>   tangent mark to-eval <id>
```
