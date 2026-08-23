import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { startRefreshLifecycle } from "./public/refresh-lifecycle.js";
import { shellDom } from "./public/shell-dom.js";

test("shell DOM lookup owns stable top-level element IDs", () => {
  const { window } = new JSDOM("<main id='screen'></main><button id='work-tab'></button>");
  const dom = shellDom(window.document);
  assert.equal(dom.screen.tagName, "MAIN");
  assert.equal(dom["work-tab"].tagName, "BUTTON");
  assert.equal(dom["areas-tab"], null);
});

test("refresh lifecycle responds to pushes and cleans up both transports", () => {
  let listener;
  let refreshes = 0;
  let closed = false;
  let cleared = null;
  class EventSourceDouble {
    /** Records the event listener. */
    addEventListener(_name, callback) { listener = callback; }
    /** Records stream closure. */
    close() { closed = true; }
  }
  const environment = {
    EventSource: EventSourceDouble,
    /** Returns one timer id. */
    setInterval() { return 7; },
    /** Records timer cleanup. */
    clearInterval(timer) { cleared = timer; },
  };
  const lifecycle = startRefreshLifecycle(() => { refreshes += 1; }, environment);
  listener();
  lifecycle.stop();
  assert.equal(refreshes, 1);
  assert.equal(closed, true);
  assert.equal(cleared, 7);
});
