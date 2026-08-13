import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Lets promise callbacks scheduled by the evaluated browser script finish. */
async function settle(window) {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Clicks one required element in the test document. */
function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected ${selector}`);
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

/** Submits one required form in the test document. */
function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert.ok(form, `Expected ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

/** Creates the small JSON response shape used by the browser API helper. */
function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    /** Returns the configured response payload. */
    async json() { return payload; },
  };
}

test("the live shell restores context, shapes work, and prepares a handoff", async () => {
  const [html, script] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  const outcomeFile = "otto/tangent/outcome-ux-product-vision.md";
  const outcome = {
    mtime: 1,
    node: "otto/tangent",
    slug: "ux-product-vision",
    file: outcomeFile,
    title: "UX Product Vision",
    status: "active",
    outcome: "Agent Shell is calm to understand, direct, and resume.",
    stateText: "The context-first shell works.\n\n### Open questions\n\n- Which moments need a checkpoint?",
    myUnderstanding: "Keep native chat central and prepare context around it.",
    currentBrief: "- You wanted: One calm surface.\n- What changed: Native chat remains complete.\n- Now: Build context around the chat.",
    storyText: "### The first shell failed\n\nIt showed controls before context.\n\n### Native chat stayed\n\nThe shell now augments the complete chat.",
    documents: [{ file: "otto/tangent/design-tangent.md", title: "Tangent product design" }],
    breakdown: [],
    depth: 0,
  };
  const vault = {
    nodes: [{ path: "otto/tangent", name: "tangent", outcomes: [outcome] }],
    map: [{ path: "otto/tangent", name: "tangent", outcomes: [outcome] }],
  };
  const posts = [];

  window.localStorage.setItem("agent-shell.current-outcome", outcomeFile);
  window.setInterval = () => 0;
  window.EventSource = class EventSource {
    /** Accepts an event listener without opening a real connection. */
    addEventListener() {}
  };
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      /** Records copied context without using the host clipboard. */
      async writeText(text) { posts.push({ path: "clipboard", body: text }); },
    },
  });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      posts.push({ path: pathname, body });
      if (pathname === "/api/work/shape") {
        return jsonResponse({
            parent: { title: "Make the scene flow reliable", outcome: "The scene flow is reliable." },
            children: [
              { title: "Terrain generation fits the view", outcome: "Terrain generation fits the view." },
              { title: "Sprite cutouts keep the asset", outcome: "Sprite cutouts keep the asset." },
            ],
            shapedBy: "model",
        });
      }
      return jsonResponse({ file: outcomeFile, files: [outcomeFile] });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({ caffeinate: false, sessions: [{ name: "tangent-vision", outcome: outcomeFile, state: "waiting", command: "codex" }] });
    }
    if (pathname === "/api/document") {
      return jsonResponse({ file: "otto/tangent/design-tangent.md", node: "otto/tangent", title: "Tangent product design", text: "# Tangent product design\n\nNative chat stays complete.", hash: "abc" });
    }
    return jsonResponse(vault);
  };

  window.eval(script);
  await settle(window);

  assert.match(window.document.querySelector("#screen").textContent, /Current brief/);
  assert.match(window.document.querySelector("#screen").textContent, /Native chat remains complete/);
  assert.match(window.document.querySelector("#screen").textContent, /2 meaningful moments/);
  assert.match(window.document.querySelector("#screen").textContent, /Open Codex/);

  click(window, "[data-share-context]");
  assert.match(window.document.querySelector("#screen").textContent, /Two-minute context/);
  assert.match(window.document.querySelector("#screen").textContent, /Which moments need a checkpoint/);
  click(window, "[data-copy-context]");
  await settle(window);
  assert.match(posts.find((entry) => entry.path === "clipboard").body, /## Current direction/);

  click(window, "#back-button");
  click(window, "[data-open-document]");
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /Native chat stays complete/);

  click(window, "#back-button");
  click(window, "#back-button");
  click(window, "[data-describe-work]");
  const description = window.document.querySelector("#shape-description");
  description.value = "Make the scene flow reliable. Terrain generation fits the view. Sprite cutouts keep the asset.";
  description.dispatchEvent(new window.Event("input", { bubbles: true }));
  submit(window, "[data-shape-capture-form]");
  await settle(window);
  assert.match(window.document.querySelector("#screen").textContent, /Keep the whole/);
  assert.equal(window.document.querySelectorAll("[data-child-index]").length, 2);
  assert.match(window.document.querySelector("[data-parent-field='title']").value, /Make the scene flow reliable/);

  submit(window, "[data-shape-review-form]");
  await settle(window);
  const batch = posts.find((entry) => entry.path === "/api/outcome/batch");
  assert.equal(batch.body.parent.title, "Make the scene flow reliable");
  assert.equal(batch.body.children.length, 2);
  assert.equal(window.localStorage.getItem("agent-shell.shape-draft"), null);

  dom.window.close();
});
