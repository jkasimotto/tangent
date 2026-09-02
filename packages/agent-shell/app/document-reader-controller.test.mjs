import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import comments from "./public/document-comments.js";
import { createDocumentReaderController } from "./public/document-reader-controller.js";
import { markdownHeadings } from "./public/markdown-structure.js";

/** Installs one focused reader DOM and returns its controller and mutable ports. */
function readerFixture(text, { api: apiOverride } = {}) {
  const dom = new JSDOM(`<main id="screen">
    <div class="document-reader-scroll" tabindex="-1"><div class="document-content"><p data-line="4">Alpha selected words omega.</p></div></div>
    <button class="selection-comment-button" type="button">Comment</button>
  </main>`, { url: "http://shell.test/" });
  const prior = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 80, left: 100, width: 120, height: 20, right: 220, bottom: 100 });
  const parsed = comments.parseComments(text);
  const state = {
    view: "document",
    document: { file: "otto/test/design.md", title: "Design", area: "otto/test", text, hash: "hash-1", comments: parsed },
    documentPositions: new Map(),
    documentTrail: [],
    documentTrailIndex: -1,
    commentComposer: null,
    commentCursor: -1,
    commentCursorIdentity: null,
  };
  const toasts = [];
  const screen = dom.window.document.querySelector("#screen");
  const controller = createDocumentReaderController({
    shell: {
      state,
      screen,
      documentPeekLayer: null,
      /** No request is needed by these controller tests. */
      async api(...args) {
        if (apiOverride) return apiOverride(...args);
        throw new Error("unexpected api call");
      },
      /** No mutation client is needed by these controller tests. */
      async post() { throw new Error("unexpected post call"); },
      /** The tests inspect state directly instead of rendering it. */
      paint() {},
      /** Test helper for paintPeek. */
      paintPeek() {},
      /** Records user-visible refusal and success text. */
      showToast(message) { toasts.push(message); },
    },
    rendering: {
      documentComments: comments,
      markdownHeadings,
      /** Test helper for documentOutlineItems. */
      documentOutlineItems: () => markdownHeadings(state.document?.text).filter((heading) => [2, 3].includes(heading.level)),
      /** Test helper for documentGoal. */
      documentGoal: () => null,
      /** Test helper for renderDocumentArticle. */
      renderDocumentArticle: () => "",
    },
    work: {
      /** Test helper for goalByFile. */
      goalByFile: () => null,
      /** Test helper for currentGoal. */
      currentGoal: () => null,
      /** Test helper for sessionsForGoal. */
      sessionsForGoal: () => [],
      humanName: String,
      areaLabel: String,
      /** Test helper for agentReference. */
      agentReference: () => "",
    },
    navigation: {
      decodeLink: String,
      /** Test helper for vaultLinkRecord. */
      vaultLinkRecord: () => null,
      /** Test helper for revealArea. */
      revealArea() {},
      /** Test helper for captureReturnPoint. */
      captureReturnPoint: () => null,
      /** Test helper for restoreReturnPoint. */
      restoreReturnPoint() {},
      /** Test helper for selectGoal. */
      selectGoal() {},
      /** Test helper for showWorkAt. */
      showWorkAt() {},
      /** Test helper for openGoalAgent. */
      openGoalAgent() {},
      /** Test helper for closeSessionLayer. */
      closeSessionLayer() {},
    },
  });
  /** Restores process globals after each focused browser-domain assertion. */
  const cleanup = () => {
    globalThis.window = prior.window;
    globalThis.document = prior.document;
    globalThis.Node = prior.Node;
    globalThis.fetch = prior.fetch;
    dom.window.close();
  };
  return { dom, screen, state, controller, toasts, cleanup };
}

test("previous comment starts at the last comment and pointer focus synchronizes by semantic identity", { concurrency: false }, () => {
  const fixture = readerFixture("# Design\n\n{>>Julian: First.<<}\n\n{>>Julian: Second.<<}\n\n{>>Julian: Third.<<}\n");
  try {
    for (const comment of fixture.state.document.comments) {
      const element = fixture.dom.window.document.createElement("aside");
      element.id = `document-comment-${comment.index}`;
      element.tabIndex = -1;
      element.scrollIntoView = (options) => { element.scrollOptions = options; };
      fixture.screen.append(element);
    }
    fixture.controller.stepComment(-1);
    assert.equal(fixture.state.commentCursor, 2);
    assert.equal(fixture.state.commentCursorIdentity.text, "Third.");
    assert.equal(fixture.dom.window.document.activeElement.id, "document-comment-2");

    const second = fixture.controller.commentIdentity(fixture.state.document.comments[1]);
    assert.equal(fixture.controller.syncCommentCursor(second), true);
    assert.equal(fixture.state.commentCursor, 1);
    fixture.controller.stepComment(1);
    assert.equal(fixture.state.commentCursorIdentity.text, "Third.");
    assert.equal(fixture.controller.syncCommentCursor({ index: 0 }), false, "an array index is not a comment identity");
  } finally {
    fixture.cleanup();
  }
});

test("the floating Comment pointer caches the exact selection before the browser collapses it", { concurrency: false }, () => {
  const fixture = readerFixture("# Design\n\n## Section\n\nAlpha selected words omega.\n");
  try {
    const text = fixture.screen.querySelector("[data-line]").firstChild;
    const range = fixture.dom.window.document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 20);
    fixture.dom.window.getSelection().addRange(range);
    fixture.controller.bindDocumentReader();
    fixture.screen.querySelector(".selection-comment-button").dispatchEvent(new fixture.dom.window.Event("pointerdown", { bubbles: true }));
    fixture.dom.window.getSelection().removeAllRanges();

    fixture.controller.openCommentComposer();
    assert.deepEqual(fixture.state.commentComposer.anchor, { kind: "selection", quote: "selected words", line: 4, offset: 6 });
    assert.equal(fixture.state.commentComposer.placeLine, 4);
    assert.equal(fixture.state.commentComposer.anchor.kind, "selection", "the collapsed click never falls back to the whole Document");
  } finally {
    fixture.cleanup();
  }
});

test("an in-flight save cannot close a newer composer", { concurrency: false }, async () => {
  const fixture = readerFixture("# Design\n\nBody.\n");
  try {
    fixture.controller.openCommentComposer();
    const first = fixture.state.commentComposer;
    first.text = "First comment.";
    let answer;
    globalThis.fetch = () => new Promise((resolve) => { answer = resolve; });
    const saving = fixture.controller.submitCommentComposer();

    fixture.state.commentComposer = { ...first, text: "New draft.", notice: "" };
    answer({ ok: true, status: 200,
      /** Returns the completed save revision. */
      async json() {
      const text = "# Design\n\nBody.\n\n{>>Julian: First comment.<<}\n";
      return { ...fixture.state.document, text, hash: "hash-2", comments: comments.parseComments(text) };
      } });
    await saving;

    assert.equal(fixture.state.commentComposer.text, "New draft.");
    assert.match(fixture.state.document.text, /First comment/);
  } finally {
    fixture.cleanup();
  }
});

test("editing refuses non-Julian comments", { concurrency: false }, () => {
  const fixture = readerFixture("# Design\n\n{>>Agent: Keep this evidence.<<}\n");
  try {
    fixture.controller.editComment(0);
    assert.equal(fixture.state.commentComposer, null);
    assert.deepEqual(fixture.toasts, ["Only Julian's comments can be edited."]);
  } finally {
    fixture.cleanup();
  }
});

test("an edit refuses the same comment body when its anchor changed", { concurrency: false }, () => {
  const fixture = readerFixture("# Design\n\n## Detail\n\nWords with {==an anchor==}{>>Julian: Explain this.<<} here.\n");
  try {
    fixture.controller.editComment(0);
    fixture.state.commentComposer.text = "Explain it clearly.";
    const changedText = "# Design\n\n{>>Julian: Explain this.<<}\n\n## Detail\n\nWords with an anchor here.\n";
    const changed = { ...fixture.state.document, text: changedText, comments: comments.parseComments(changedText) };
    const result = fixture.controller.composerResult(changed, fixture.state.commentComposer);
    assert.match(result.error, /changed or disappeared/i);
    assert.doesNotMatch(changed.text, /Explain it clearly/);
  } finally {
    fixture.cleanup();
  }
});

test("a vanished edit target after a conflict keeps its draft and never creates a Document comment", { concurrency: false }, async () => {
  const fixture = readerFixture("# Design\n\n{>>Julian: Original note.<<}\n\nBody.\n");
  try {
    fixture.controller.editComment(0);
    const field = fixture.dom.window.document.createElement("textarea");
    field.id = "comment-text";
    field.value = "Careful revised note.";
    fixture.screen.append(field);
    const currentText = "# Design\n\nBody changed and the comment is gone.\n";
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      const submitted = JSON.parse(options.body);
      assert.match(submitted.text, /Careful revised note/);
      return {
        ok: false,
        status: 409,
        /** Supplies the changed server revision without the edit target. */
        async json() {
          return { error: "document changed since it was opened", current: { ...fixture.state.document, text: currentText, hash: "hash-2", comments: [] } };
        },
      };
    };

    await fixture.controller.submitCommentComposer();
    assert.equal(calls, 1, "a missing target is not retried at a wider scope");
    assert.equal(fixture.state.commentComposer.text, "Careful revised note.");
    assert.match(fixture.state.commentComposer.notice, /changed or disappeared/i);
    assert.equal(fixture.state.document.text, currentText);
    assert.doesNotMatch(fixture.state.document.text, /Careful revised note|\{>>Julian:/, "the draft was not inserted under the title");
  } finally {
    fixture.cleanup();
  }
});

test("a reply uses the original semantic selection anchor and fails closed when it vanishes", { concurrency: false }, () => {
  const fixture = readerFixture("# Design\n\nAlpha {==selected words==}{>>Julian: Explain this.<<} omega.\n");
  try {
    const identity = fixture.controller.commentIdentity(fixture.state.document.comments[0]);
    fixture.controller.syncCommentCursor(identity);
    fixture.controller.replyToActiveComment();
    const composer = fixture.state.commentComposer;
    assert.equal(composer.replying.text, "Explain this.");
    assert.deepEqual(composer.anchor, { kind: "selection", quote: "selected words", line: 2, offset: 6 });
    composer.text = "Here is the reason.";
    const result = fixture.controller.composerResult(fixture.state.document, composer);
    assert.match(result.text, /\{==selected words==\}\{>>Julian: Explain this\.<<\}\{>>Julian: Here is the reason\.<<\}/);

    const changedText = "# Design\n\nAlpha selected words omega.\n";
    const changed = { ...fixture.state.document, text: changedText, comments: comments.parseComments(changedText) };
    const stale = fixture.controller.composerResult(changed, composer);
    assert.match(stale.error, /reply is still here/i);
    assert.doesNotMatch(changed.text, /Here is the reason/);
  } finally {
    fixture.cleanup();
  }
});

test("a standalone reply is adjacent to its exact comment instead of moving to the section heading", { concurrency: false }, () => {
  const fixture = readerFixture("# Design\n\n## Detail\n\nParagraph first.\n\n{>>Julian: Existing standalone note.<<}\n\nParagraph after.\n");
  try {
    fixture.controller.syncCommentCursor(fixture.controller.commentIdentity(fixture.state.document.comments[0]));
    fixture.controller.replyToActiveComment();
    fixture.state.commentComposer.text = "Adjacent reply.";
    const result = fixture.controller.composerResult(fixture.state.document, fixture.state.commentComposer);
    assert.match(result.text, /\{>>Julian: Existing standalone note\.<<\}\n\{>>Julian: Adjacent reply\.<<\}\n\nParagraph after\./);
    assert.doesNotMatch(result.text, /## Detail\n\{>>Julian: Adjacent reply/);
  } finally {
    fixture.cleanup();
  }
});

test("canonical resolve requires a note, omits mutable indexes, and reloads before choosing semantic focus", { concurrency: false }, async () => {
  const initial = "# Design\n\n{>>Julian: First note.<<}\n\n{>>Julian: Second note.<<}\n";
  const resolvedText = "# Design\n\n{>>Julian: Second note.<<}\n";
  let reads = 0;
  const fixture = readerFixture(initial, {
    /** Test helper for api. */
    api: async (url) => {
      assert.match(url, /\/api\/document\?file=/);
      reads += 1;
      const text = reads === 1 ? initial : resolvedText;
      return { ...fixture.state.document, text, hash: `hash-${reads + 1}`, comments: comments.parseComments(text) };
    },
  });
  try {
    fixture.controller.syncCommentCursor(fixture.controller.commentIdentity(fixture.state.document.comments[0]));
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { file: "otto/test/design.md", prefix: "First note.", note: "Implemented the requested change." });
      assert.equal("index" in body, false);
      assert.equal("session" in body, false);
      return { ok: true, status: 200,
        /** Test helper for json. */
        async json() { return { remaining: 1 }; } };
    };

    const missing = await fixture.controller.resolveActiveComment(fixture.controller.activeCommentIdentity(), "   ");
    assert.equal(missing.ok, false);
    assert.equal(calls, 0, "a blank note never reaches the canonical route");

    const result = await fixture.controller.resolveActiveComment(fixture.controller.activeCommentIdentity(), " Implemented the requested change. ");
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(fixture.state.document.comments.length, 1);
    assert.equal(fixture.state.commentCursorIdentity.text, "Second note.");
    assert.equal(result.focusIdentity.text, "Second note.");
  } finally {
    fixture.cleanup();
  }
});

test("an ambiguous canonical resolve keeps the active semantic target available for retry", { concurrency: false }, async () => {
  const text = "# Design\n\n{>>Julian: Same note.<<}\n\n## Other\n\n{>>Julian: Same note.<<}\n";
  const fixture = readerFixture(text, {
    /** Test helper for api. */
    api: async () => fixture.state.document });
  try {
    const identity = fixture.controller.commentIdentity(fixture.state.document.comments[0]);
    fixture.controller.syncCommentCursor(identity);
    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      /** Test helper for json. */
      async json() { return { error: "2 comments start with those words. Give more of the text." }; },
    });
    const result = await fixture.controller.resolveActiveComment(identity, "Handled both cases.");
    assert.equal(result.ok, false);
    assert.match(result.error, /2 comments/i);
    assert.equal(fixture.controller.activeCommentIdentity().line, identity.line);
    assert.equal(fixture.state.document.comments.length, 2);
  } finally {
    fixture.cleanup();
  }
});

test("resolve checks a fresh semantic anchor and never posts when it changed", { concurrency: false }, async () => {
  const initial = "# Design\n\nWords {==here==}{>>Julian: Explain this.<<}.\n";
  const moved = "# Design\n\n{>>Julian: Explain this.<<}\n\nWords here.\n";
  const fixture = readerFixture(initial, {
    /** Test helper for api. */
    api: async () => ({ ...fixture.state.document, text: moved, hash: "hash-2", comments: comments.parseComments(moved) }),
  });
  try {
    const identity = fixture.controller.commentIdentity(fixture.state.document.comments[0]);
    fixture.controller.syncCommentCursor(identity);
    let posts = 0;
    globalThis.fetch = async () => { posts += 1; throw new Error("should not post"); };
    const result = await fixture.controller.resolveActiveComment(identity, "Implemented it.");
    assert.equal(result.ok, false);
    assert.match(result.error, /changed or disappeared/i);
    assert.equal(posts, 0);
    assert.equal(fixture.state.document.text, initial, "the open draft context is not replaced under the modal");
  } finally {
    fixture.cleanup();
  }
});

test("a style note posts to the corpus, saves no Document, and offers no undo", { concurrency: false }, async () => {
  const text = "# Design\n\n## Section\n\nAlpha selected words omega.\n";
  const fixture = readerFixture(text);
  try {
    const posts = [];
    globalThis.fetch = async (url, options) => {
      posts.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200,
        /** Returns the recorded corpus entry. */
        async json() { return { note: { id: "note-1" } }; } };
    };
    fixture.controller.openCommentComposer();
    assert.equal(fixture.state.commentComposer.kind, "comment", "the composer opens as a comment, which is the common case");
    fixture.controller.setCommentKind("style");
    fixture.state.commentComposer.text = "Three clauses before the subject.";
    await fixture.controller.submitCommentComposer();

    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/style-notes", "a style note never reaches the Document save route");
    assert.deepEqual(posts[0].body, { file: "otto/test/design.md", note: "Three clauses before the subject.", quote: "" });
    assert.equal(fixture.state.document.text, text, "the Document Julian reads is untouched");
    assert.equal(fixture.state.document.comments.length, 0, "no comment was created");
    assert.equal(fixture.state.commentComposer, null, "the composer closes on success");
    assert.deepEqual(fixture.toasts, ["Style note saved. It stays out of the Document."]);
  } finally {
    fixture.cleanup();
  }
});

test("a style note on selected words carries those exact words to the corpus", { concurrency: false }, async () => {
  const fixture = readerFixture("# Design\n\n## Section\n\nAlpha selected words omega.\n");
  try {
    const text = fixture.screen.querySelector("[data-line]").firstChild;
    const range = fixture.dom.window.document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 20);
    fixture.dom.window.getSelection().addRange(range);
    let body = null;
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 200,
        /** Returns the recorded corpus entry. */
        async json() { return { note: { id: "note-1" } }; } };
    };
    fixture.controller.openCommentComposer();
    fixture.controller.setCommentKind("style");
    fixture.state.commentComposer.text = "Buried lede.";
    await fixture.controller.submitCommentComposer();
    assert.equal(body.quote, "selected words", "the snapshot is the words as the reader showed them");
  } finally {
    fixture.cleanup();
  }
});

test("a refused style note keeps the draft and the Document, and says why", { concurrency: false }, async () => {
  const fixture = readerFixture("# Design\n\nBody.\n");
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404,
      /** Returns the server's refusal. */
      async json() { return { error: "no Document otto/test/design.md" }; } });
    fixture.controller.openCommentComposer();
    fixture.controller.setCommentKind("style");
    fixture.state.commentComposer.text = "Buried lede.";
    await fixture.controller.submitCommentComposer();
    assert.equal(fixture.state.commentComposer.notice, "no Document otto/test/design.md");
    assert.equal(fixture.state.commentComposer.text, "Buried lede.", "the draft survives the refusal");
    assert.deepEqual(fixture.toasts, []);
  } finally {
    fixture.cleanup();
  }
});

test("the kind switch belongs to a new note only, and an empty style note is refused before any request", { concurrency: false }, async () => {
  const fixture = readerFixture("# Design\n\n{>>Julian: Say why.<<}\n");
  try {
    globalThis.fetch = () => { throw new Error("an empty style note must never reach the server"); };
    fixture.controller.openCommentComposer();
    fixture.controller.setCommentKind("style");
    fixture.state.commentComposer.text = "   ";
    await fixture.controller.submitCommentComposer();
    assert.equal(fixture.state.commentComposer.notice, "Write what the writing did wrong.");

    fixture.controller.editComment(0);
    fixture.controller.setCommentKind("style");
    assert.notEqual(fixture.state.commentComposer.kind, "style", "an edit of an existing comment can never become a style note");
  } finally {
    fixture.cleanup();
  }
});
