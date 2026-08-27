import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { plannedWorkFixture, workTableFixture } from "./work-table-fixture.mjs";

/** Dispatches one cancellable key from an exact surface. */
function keyFrom(window, target, key, options = {}) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

/** Installs a focusable xterm-shaped fake for session-layer focus proofs. */
function installTerminalFake(window) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.ResizeObserver = class ResizeObserver {
    /** Test helper for observe. */
    observe() {}
    /** Test helper for disconnect. */
    disconnect() {} };
  window.FitAddon = { FitAddon: class FitAddon {
    /** Test helper for proposeDimensions. */
    proposeDimensions() { return { cols: 100, rows: 40 }; }
    /** Test helper for fit. */
    fit() {} } };
  window.WebSocket = class WebSocket {
    static OPEN = 1;
    readyState = 1;
    constructor() { window.setTimeout(() => this.onopen?.(), 0); }
    /** Test helper for send. */
    send() {}
    /** Test helper for close. */
    close() {}
  };
  window.Terminal = class Terminal {
    constructor() { this.cols = 100; this.rows = 40; }
    /** Test helper for loadAddon. */
    loadAddon() {}
    /** Test helper for open. */
    open(host) {
      this.element = window.document.createElement("div");
      this.element.className = "xterm";
      this.input = window.document.createElement("textarea");
      this.input.className = "xterm-helper-textarea";
      this.element.append(this.input);
      host.append(this.element);
    }
    /** Test helper for focus. */
    focus() { this.input.focus(); }
    /** Test helper for onSelectionChange. */
    onSelectionChange() { return {
      /** Test helper for dispose. */
      dispose() {} }; }
    /** Test helper for onData. */
    onData() { return {
      /** Test helper for dispose. */
      dispose() {} }; }
    /** Test helper for attachCustomKeyEventHandler. */
    attachCustomKeyEventHandler() {}
    /** Test helper for getSelection. */
    getSelection() { return ""; }
    /** Test helper for getSelectionPosition. */
    getSelectionPosition() { return null; }
    /** Test helper for hasSelection. */
    hasSelection() { return false; }
    /** Test helper for clearSelection. */
    clearSelection() {}
    /** Test helper for dispose. */
    dispose() { this.element?.remove(); }
    /** Test helper for write. */
    write() {}
  };
}

test("an open terminal gives every key except Command-J to xterm", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  row.querySelector("[data-work-row-title]").focus();
  press(window, "j", { metaKey: true });
  await settle(window);

  const terminal = document.querySelector("#session-layer-terminal");
  const cursor = document.querySelector("[data-work-cursor].cursor").dataset.workCursor;
  for (const [key, options] of [["k", { metaKey: true }], ["/", { metaKey: true }], ["Escape", {}], ["j", {}], ["?", {}]]) {
    const event = keyFrom(window, terminal, key, options);
    assert.equal(event.defaultPrevented, false, `${key} remains native to xterm`);
  }
  assert.equal(document.querySelector("#go-to-layer").hidden, true, "Command-K did not open Go To");
  assert.equal(document.querySelector("#modal-layer").hidden, true, "Work help did not leak through");
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, cursor, "Work did not move below the terminal");
  assert.equal(document.querySelector("#session-layer").hidden, false, "Escape did not close the session");

  const leave = keyFrom(window, terminal, "j", { metaKey: true });
  await settle(window);
  assert.equal(leave.defaultPrevented, true, "Command-J is withheld from xterm");
  assert.equal(document.querySelector("#session-layer").hidden, true);
  assert.equal(document.querySelector("#screen").hasAttribute("inert"), false, "Work becomes interactive only after the session closes");
});

test("a modal blocks lower shortcuts, traps focus, and restores its opener", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const opener = document.querySelector("[data-work-row-title]");
  const cursor = document.querySelector("[data-work-cursor].cursor").dataset.workCursor;
  opener.focus();
  press(window, "?");
  await settle(window);

  const modal = document.querySelector("#modal-layer");
  assert.equal(modal.hidden, false);
  assert.equal(document.querySelector("#screen").hasAttribute("inert"), true);
  keyFrom(window, document.activeElement, "k", { metaKey: true });
  keyFrom(window, document.activeElement, "j");
  assert.equal(document.querySelector("#go-to-layer").hidden, true);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, cursor);

  const keySheet = modal.querySelector(".modal-copy");
  assert.equal(document.activeElement, keySheet, "the scrollable key sheet is the first focus stop");
  const confirm = modal.querySelector("[data-modal-confirm]");
  confirm.focus();
  press(window, "Tab");
  assert.equal(document.activeElement, keySheet, "Tab wraps from Close to the scrollable key sheet");
  press(window, "Tab", { shiftKey: true });
  assert.equal(document.activeElement, confirm, "Shift-Tab wraps back to Close");
  press(window, "Escape");
  assert.equal(modal.hidden, true);
  assert.equal(document.querySelector("#screen").hasAttribute("inert"), false);
  assert.equal(document.activeElement, opener, "closing restores the exact opener");
});

test("a command modal hands focus to a live session instead of restoring inert Work", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  installTerminalFake(window);
  const area = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row");
  area.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  area.querySelector("[data-work-cursor-control]").focus();
  press(window, ":", { shiftKey: true });
  await settle(window);
  const commands = document.querySelector("[data-modal-select]");
  commands.value = "openBrain";
  document.querySelector("[data-modal-confirm]").click();
  await settle(window, 5);

  assert.equal(document.querySelector("#session-layer").hidden, false);
  assert.ok(document.activeElement.matches("#session-layer-terminal .xterm-helper-textarea"), "the new terminal retains focus after modal teardown");
  assert.equal(document.activeElement.closest("[inert]"), null, "focus never returns behind the session layer");
  window.close();
});

test("Escape clears Area Work and Document searches before leaving their field", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  document.querySelector("[data-open-area='otto/onboarding']").click();
  await settle(window);

  for (const id of ["area-work-search", "area-document-search"]) {
    let input = document.querySelector(`#${id}`);
    input.value = "needle";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(window);
    input = document.querySelector(`#${id}`);
    input.focus();
    press(window, "Escape");
    await settle(window);
    assert.equal(document.querySelector(`#${id}`).value, "", `${id} clears first`);
    assert.equal(document.activeElement.id, id, `${id} keeps keyboard focus after clearing`);
  }
  window.close();
});

test("Escape and pointer Back close a Work details menu before navigating", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const menu = document.querySelector(".work-group-action-menu");
  const summary = menu.querySelector("summary");
  menu.open = true;
  menu.querySelector("button").focus();
  press(window, "Escape");
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, summary, "Escape returns to the disclosure summary");

  menu.open = true;
  document.querySelector("#back-button").click();
  assert.equal(menu.open, false, "pointer Back closes the same top disclosure");
  assert.equal(document.querySelector("#shell-menu").hidden, true, "Back does not open the parent menu yet");
  assert.equal(document.activeElement, summary);
  window.close();
});

test("Work Escape unwinds each state in the settled order", async () => {
  const { window, document } = await bootWorkTable(plannedWorkFixture(), { workFilter: "inactive", areaFocus: ["otto/tangent"] });
  let search = document.querySelector("#work-search");
  search.value = "sandbox";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  document.querySelector("[data-check-goal='otto/tangent/goal-startable.md']").click();
  await settle(window);
  document.querySelector("[data-open-area-focus]").click();
  await settle(window);
  document.querySelector("#back-button").click();
  assert.equal(document.querySelector("#shell-menu").hidden, false);

  press(window, "Escape");
  assert.equal(document.querySelector("#shell-menu").hidden, true, "1: transient surface");
  assert.ok(document.querySelector("[data-area-focus-picker]"), "staged Focus remains");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.querySelector("[data-area-focus-picker]"), null, "2: staged Focus");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.querySelectorAll("tr.work-row.selected").length, 0, "3: Goal selection");
  press(window, "Escape");
  await settle(window);
  search = document.querySelector("#work-search");
  assert.equal(search.value, "", "4: Work query");
  assert.ok(document.querySelector("[data-clear-area-focus]"), "applied Focus remains until the next Escape");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.querySelector("[data-clear-area-focus]"), null, "5: applied Focus");
  assert.ok(document.activeElement.closest("[data-work-cursor]"), "clearing Focus restores a visible Work row, not a closed-menu control");
  press(window, "Escape");
  assert.equal(document.activeElement, document.querySelector("#work-tab"), "6: Work tab");
});

test("keyboard x and pointer Done confirm and complete the exact row", async () => {
  const { window, document, posts } = await bootWorkTable(workTableFixture());
  const stale = "otto/tangent/goal-inconsistencies.md";
  const target = "otto/tangent/goal-compact-table.md";
  document.querySelector(`[data-stop-goal='${stale}']`).click();
  document.querySelector("[data-modal-cancel]").click();
  await settle(window);
  document.querySelector(`[data-goal-anchor='${target}']`).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, `goal:${target}`);
  press(window, "x");
  assert.match(document.querySelector("#modal-title").textContent, /Redesign Work as a compact table/);
  assert.equal(posts.length, 0, "x only opens the shared confirmation");
  const cancel = document.querySelector("[data-modal-cancel]");
  cancel.focus();
  keyFrom(window, cancel, "Enter");
  await settle(window);
  assert.equal(posts.length, 0, "Enter on Cancel never invokes the confirmation action");
  if (!document.querySelector("#modal-layer").hidden) cancel.click();

  document.querySelector(`[data-complete-goal='${target}']`).click();
  assert.match(document.querySelector("#modal-title").textContent, /Redesign Work as a compact table/);
  assert.equal(posts.length, 0, "pointer Done uses the same confirmation");
  document.querySelector("[data-modal-confirm]").click();
  await settle(window);
  const edit = posts.find((item) => item.path === "/api/goals/edit");
  assert.deepEqual(edit?.body, { file: target, status: "done" });
});
