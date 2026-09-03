import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AreaMapController, SaveResult, SaveStatus } from "../../kernel/kernel-types.ts";
import { recoverMap } from "./save-effects.ts";

/** A controller that answers the given results and reports the given save state afterwards. */
function fakeController(answers: { retry?: SaveResult | null; keepMine?: SaveResult | null; reloadThrows?: string }, state: SaveStatus): AreaMapController {
  /** Answers the retry the fixture was built with. */
  const retry = async (): Promise<SaveResult | null> => answers.retry ?? null;
  /** Answers the keep-mine the fixture was built with. */
  const keepMine = async (): Promise<SaveResult | null> => answers.keepMine ?? null;
  /** Reloads, or throws the words the fixture was built with. */
  const reload = async (): Promise<unknown> => {
    if (answers.reloadThrows) throw new Error(answers.reloadThrows);
    return {};
  };
  /** The save state the fixture reports after any call. */
  const snapshot = (): { save: { state: SaveStatus; result: null } } => ({ save: { state, result: null } });
  return { retry, keepMine, reload, snapshot } as unknown as AreaMapController;
}

/** Collects announcements. */
function recorder(): { said: string[]; announce: (text: string) => void } {
  const said: string[] = [];
  /** Records one announcement. */
  const announce = (text: string): void => { said.push(text); };
  return { said, announce };
}

test("retry answers the controller's result and says nothing itself", async () => {
  const spoken = recorder();
  const result = await recoverMap(fakeController({ retry: { status: 200 } }, "saved"), "retry", spoken.announce);
  assert.deepEqual(result, { status: 200 });
  assert.deepEqual(spoken.said, []);
});

test("keep mine without an answer says it is unavailable", async () => {
  const spoken = recorder();
  const result = await recoverMap(fakeController({ keepMine: null }, "conflict"), "keepMine", spoken.announce);
  assert.equal(result, null);
  assert.deepEqual(spoken.said, ["Keep mine is unavailable. Retry or reload saved."]);
});

test("keep mine that saved says so", async () => {
  const spoken = recorder();
  await recoverMap(fakeController({ keepMine: { status: 200 } }, "saved"), "keepMine", spoken.announce);
  assert.deepEqual(spoken.said, ["Map saved with local changes."]);
});

test("reload reports the reload and answers null", async () => {
  const spoken = recorder();
  const result = await recoverMap(fakeController({}, "saved"), "reload", spoken.announce);
  assert.equal(result, null);
  assert.deepEqual(spoken.said, ["Saved map reloaded."]);
});

test("a controller that throws is spoken, not rethrown", async () => {
  const spoken = recorder();
  const result = await recoverMap(fakeController({ reloadThrows: "server gone" }, "blocked"), "reload", spoken.announce);
  assert.equal(result, null);
  assert.deepEqual(spoken.said, ["Map not saved. server gone"]);
});
