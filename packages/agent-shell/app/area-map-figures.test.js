import assert from "node:assert/strict";
import test from "node:test";

import {
  createFigureElements, figureCacheKey, figureCaptionGeometry, figureForFact, figureIconBox,
  figureIconName, figurePresentationMarker, iconBounds, isMapKindState, isMapKindVerb, restoreFigurePresentation, themeInkColor,
} from "./public/area-map-figures.js";

const block = { id: "block-1", x: 100, y: 200, width: 280, height: 132, opacity: 100 };

/** Builds one small icon in its normal form. */
function icon(elements) {
  const bounds = iconBounds(elements);
  return { name: "worktree", width: bounds.width, height: bounds.height, elements, elementCount: elements.length, warning: null };
}

test("the first matching state wins, then the default icon, then the card", () => {
  const entry = {
    id: "worktree", icon: "worktree",
    icons: [{ when: "missing", icon: "worktree-missing" }, { when: "dirty", icon: "worktree-dirty" }],
    problems: [],
  };
  assert.equal(figureIconName(entry, ["available", "branch", "dirty"]), "worktree-dirty");
  assert.equal(figureIconName(entry, ["missing", "dirty"]), "worktree-missing", "the entry order decides, not the state order");
  assert.equal(figureIconName(entry, ["available", "clean"]), "worktree");
  assert.equal(figureIconName({ ...entry, problems: ["icon `worktre` not found"] }, ["dirty"]), null);
  assert.equal(figureIconName({ id: "document", icons: [], problems: [] }, []), null);

  const figures = { kinds: new Map([["worktree", entry]]), icons: { worktree: icon([{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]) } };
  assert.equal(figureForFact(figures, { kindId: "worktree", states: ["clean"] }).iconName, "worktree");
  assert.equal(figureForFact(figures, { kindId: "worktree", states: ["dirty"] }), null, "a named icon with no drawing is a card");
  assert.equal(figureForFact(figures, { kindId: "document", states: [] }), null);
});

test("an icon scales into the Block icon square, keeps its aspect, and never scales stroke width", () => {
  const drawing = icon([
    { id: "body", type: "rectangle", x: 0, y: 0, width: 100, height: 50, strokeWidth: 2, seed: 7, versionNonce: 11 },
    { id: "edge", type: "line", x: 10, y: 10, width: 40, height: 20, strokeWidth: 2, points: [[0, 0], [40, 20]], seed: 8 },
    { id: "word", type: "text", x: 0, y: 0, width: 20, height: 10, fontSize: 20, text: "x", seed: 9 },
  ]);
  const [body, edge, word] = createFigureElements({ block, icon: drawing, iconName: "worktree", opacity: 100, owner: "otto/tangent", sourceId: "source-1" });
  const boxSide = figureIconBox(block);
  assert.equal(boxSide, 108);
  const scale = boxSide / 100;
  assert.equal(body.width, 100 * scale);
  assert.equal(body.height, 50 * scale);
  assert.equal(body.strokeWidth, 2, "a constant stroke keeps the hand-drawn weight equal across icons");
  assert.deepEqual(edge.points, [[0, 0], [40 * scale, 20 * scale]]);
  assert.equal(word.fontSize, 20 * scale);
  assert.equal(body.y + body.height / 2, block.y + block.height / 2, "the drawing centres in the icon square");
  for (const element of [body, edge, word]) {
    assert.equal(element.locked, true);
    assert.equal(element.isDeleted, false);
    assert.equal(element.customData.tangentWorldEphemeral.kind, "resource-figure-icon");
    assert.equal(element.customData.tangentWorldEphemeral.sourceId, block.id);
    assert.equal(element.customData.tangentWorld.owner, "otto/tangent");
  }
  assert.equal(body.seed, 7, "the file's seed keeps every instance of one icon identical");
});

test("icon ids and bindings are remapped per instance and a binding outside the icon is dropped", () => {
  const drawing = icon([
    { id: "container", type: "rectangle", x: 0, y: 0, width: 40, height: 40, boundElements: [{ id: "caption", type: "text" }, { id: "elsewhere", type: "text" }] },
    { id: "caption", type: "text", x: 4, y: 4, width: 20, height: 10, containerId: "container", fontSize: 16, text: "hi" },
    { id: "wire", type: "arrow", x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]], startBinding: { elementId: "container", focus: 0, gap: 1 }, endBinding: { elementId: "elsewhere", focus: 0, gap: 1 } },
  ]);
  const [container, caption, wire] = createFigureElements({ block, icon: drawing, iconName: "worktree" });
  assert.equal(container.id, "block-1-tangent-icon-0");
  assert.equal(caption.containerId, container.id);
  assert.deepEqual(container.boundElements, [{ id: caption.id, type: "text" }]);
  assert.equal(wire.startBinding.elementId, container.id);
  assert.equal(wire.endBinding, null);
  assert.deepEqual(container.groupIds, []);
  assert.equal(container.frameId, null);
  assert.equal(container.link, null);
});

test("a gone figure carries its opacity, and the cache key follows every drawn value", () => {
  const drawing = icon([{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]);
  const [faded] = createFigureElements({ block, icon: drawing, iconName: "worktree", opacity: 45 });
  assert.equal(faded.opacity, 45);
  const key = figureCacheKey(block, "worktree", 45);
  assert.notEqual(key, figureCacheKey(block, "worktree", 100));
  assert.notEqual(key, figureCacheKey({ ...block, x: 101 }, "worktree", 45));
  assert.notEqual(key, figureCacheKey(block, "worktree-dirty", 45));
});

test("the caption sits beside the icon and the restore puts every composed value back", () => {
  const caption = figureCaptionGeometry(block);
  assert.equal(caption.x, block.x + 14 + figureIconBox(block) + 10);
  assert.equal(caption.y, block.y + 12);
  assert.equal(caption.width, block.width - figureIconBox(block) - 38);
  assert.equal(caption.textAlign, "left");
  assert.equal(caption.verticalAlign, "middle");

  const composed = { id: "body", strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid", opacity: 100, customData: { tangent: { kind: "resource", ref: "one" } } };
  const marker = figurePresentationMarker(composed, ["strokeColor", "backgroundColor", "fillStyle", "opacity"]);
  const projected = { ...composed, strokeColor: "transparent", backgroundColor: "#ffffff01", opacity: 45, customData: { ...composed.customData, tangentWorldFigure: marker } };
  const [restored] = restoreFigurePresentation([projected]);
  assert.equal(restored.strokeColor, "#1971c2");
  assert.equal(restored.backgroundColor, "#a5d8ff");
  assert.equal(restored.opacity, 100);
  assert.equal(restored.customData.tangentWorldFigure, undefined);
  assert.deepEqual(restored.customData.tangent, composed.customData.tangent);
  const untouched = { id: "other", strokeColor: "#000000" };
  assert.equal(restoreFigurePresentation([untouched])[0], untouched, "an element with no marker is returned as it is");

  // A caption records its offset, so it lands where a drag left its Block.
  const moved = { id: "body", x: 400, y: 500 };
  const captionElement = { id: "caption", containerId: "body", x: 532, y: 512, textAlign: "left", verticalAlign: "middle", customData: { tangentWorldFigure: { containerId: "body", dx: 14, dy: 16, width: 252, height: 100, textAlign: "center", verticalAlign: "middle", opacity: 100 } } };
  const [, restoredCaption] = restoreFigurePresentation([moved, captionElement]);
  assert.deepEqual({ x: restoredCaption.x, y: restoredCaption.y }, { x: 414, y: 516 });
  assert.equal(restoredCaption.textAlign, "center");
  assert.equal(restoredCaption.customData.tangentWorldFigure, undefined);
});

test("figure ink survives the Map's theme filter, so an icon renders as it was drawn", () => {
  // The canvas filter is invert(93%) then hue-rotate(180deg). Applying it to a
  // pre-inverted colour returns close to the drawn colour, and dark ink stays
  // dark on the Map's light ground.
  assert.equal(themeInkColor("#1e1e1e"), "#d3d3d3");
  assert.equal(themeInkColor(themeInkColor("#1e1e1e")), "#383838");
  assert.equal(themeInkColor("transparent"), "transparent");
  assert.equal(themeInkColor("#fff"), themeInkColor("#ffffff"));
  /** Returns the largest channel distance between two rendered hex colours. */
  const distance = (left, right) => Math.max(...[1, 3, 5].map((at) => Math.abs(Number.parseInt(left.slice(at, at + 2), 16) - Number.parseInt(right.slice(at, at + 2), 16))));
  for (const drawn of ["#2f9e44", "#9c36b5", "#868e96"]) {
    assert.ok(distance(themeInkColor(themeInkColor(drawn)), drawn) <= 30, `${drawn} renders as ${themeInkColor(themeInkColor(drawn))}`);
  }

  const drawing = icon([{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, strokeColor: "#1e1e1e", backgroundColor: "transparent" }]);
  const [element] = createFigureElements({ block, icon: drawing, iconName: "worktree" });
  assert.equal(element.strokeColor, "#d3d3d3");
  assert.equal(element.backgroundColor, "transparent", "a transparent fill stays transparent");
});

test("the shared vocabulary closes the states and verbs one entry may name", () => {
  assert.equal(isMapKindState("path", "dirty"), true);
  assert.equal(isMapKindState("path", "gone"), true);
  assert.equal(isMapKindState("path", "success"), false);
  assert.equal(isMapKindState("url", "unreachable"), true, "unreachable is reserved and never observed");
  assert.equal(isMapKindVerb("path", "copy-path"), true);
  assert.equal(isMapKindVerb("path", "open"), false);
  assert.equal(isMapKindVerb("vault", "open-goal"), true);
  assert.equal(isMapKindVerb("vault", "details"), false);
});
