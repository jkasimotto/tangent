// The starter Map kinds definition and the thirteen starter icon drawings.
// Tangent writes these into the vault once, when the definition file is missing
// or the icon folder is empty, and never rewrites them: from then on Julian
// owns both. Every drawing is ordinary Excalidraw ink in the colours it should
// render in; the figure projection makes it survive the Map's theme filter.
// Design: docs/design/map-resource-icons/product.md

import { createShapeElement } from "./public/area-board-core.js";

const INK = "#1e1e1e";
const MERGED = "#9c36b5";
const ACCEPTED = "#2f9e44";
const CLOSED = "#868e96";

/** Creates one icon shape with the hand-drawn defaults every starter icon uses. */
function shape(id, type, x, y, width, height, style = {}) {
  return createShapeElement({
    id, type, x, y, width, height,
    style: { backgroundColor: "transparent", strokeColor: INK, strokeWidth: 2, roughness: 1, ...style },
  });
}

/** Creates one open polyline whose points are relative to its own origin. */
function line(id, x, y, points, style = {}) {
  const width = Math.max(1, Math.max(...points.map(([px]) => px)) - Math.min(...points.map(([px]) => px)));
  const height = Math.max(1, Math.max(...points.map(([, py]) => py)) - Math.min(...points.map(([, py]) => py)));
  return {
    ...shape(id, "line", x, y, width, height, { ...style, roundness: null }),
    points: points.map(([px, py]) => [px, py]),
    lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null,
  };
}

/** Creates one arrowed polyline that points at its last point. */
function arrow(id, x, y, points, style = {}) {
  return { ...line(id, x, y, points, style), type: "arrow", endArrowhead: "arrow", elbowed: false };
}

/** Draws the folder and the tree that make a worktree recognisable. */
function worktreeInk(style = {}) {
  return [
    shape("tab", "rectangle", 10, 32, 30, 12, style),
    shape("folder", "rectangle", 10, 42, 80, 48, style),
    line("trunk", 66, 12, [[0, 0], [0, 30]], style),
    shape("canopy", "ellipse", 50, 0, 32, 24, style),
  ];
}

/** Draws the book and the fork mark that make a repository recognisable. */
function repositoryInk(style = {}) {
  return [
    shape("cover", "rectangle", 16, 10, 68, 80, style),
    line("spine", 26, 10, [[0, 0], [0, 80]], style),
    shape("root", "ellipse", 40, 44, 12, 12, style),
    line("up", 52, 48, [[0, 0], [12, -14]], style),
    line("down", 52, 54, [[0, 0], [12, 14]], style),
    shape("branch-up", "ellipse", 62, 26, 12, 12, style),
    shape("branch-down", "ellipse", 62, 62, 12, 12, style),
  ];
}

/** Draws the left dot, stem, and lower dot every pull-request mark shares. */
function pullRequestStem(style = {}) {
  return [
    shape("head", "ellipse", 14, 12, 18, 18, style),
    line("stem", 23, 30, [[0, 0], [0, 46]], style),
    shape("foot", "ellipse", 14, 74, 18, 18, style),
  ];
}

/** Draws the page and its diff marks, the base of every revision icon. */
function revisionInk(style = {}) {
  return [
    shape("page", "rectangle", 18, 6, 64, 88, style),
    line("plus-across", 28, 22, [[0, 0], [14, 0]], style),
    line("plus-down", 35, 15, [[0, 0], [0, 14]], style),
    line("minus", 28, 38, [[0, 0], [14, 0]], style),
  ];
}

/** Draws a cross in one 20 by 20 square. */
function cross(x, y, style = {}) {
  return [
    line("cross-a", x, y, [[0, 0], [20, 20]], style),
    line("cross-b", x + 20, y, [[0, 0], [-20, 20]], style),
  ];
}

const DASHED = { strokeStyle: "dashed", backgroundColor: "transparent" };

/** The drawing of each starter icon, keyed by its icon name. */
const STARTER_ICON_ELEMENTS = {
  worktree: worktreeInk(),
  "worktree-dirty": [
    ...worktreeInk(),
    line("pencil", 24, 80, [[0, 0], [34, -26]], { strokeWidth: 3 }),
    line("pencil-tip", 58, 54, [[0, 0], [8, -6], [4, 10], [-12, -4]], { strokeWidth: 1 }),
  ],
  "worktree-missing": worktreeInk(DASHED),
  repository: repositoryInk(),
  "repository-missing": repositoryInk(DASHED),
  link: [
    shape("left", "ellipse", 8, 46, 52, 28, { angle: -0.6 }),
    shape("right", "ellipse", 40, 26, 52, 28, { angle: -0.6 }),
  ],
  "pull-request": [
    ...pullRequestStem(),
    shape("target", "ellipse", 68, 12, 18, 18),
    arrow("branch", 28, 62, [[0, 0], [21, 0], [21, -26]]),
  ],
  "pull-request-merged": [
    shape("one", "ellipse", 12, 10, 18, 18, { strokeColor: MERGED }),
    shape("two", "ellipse", 12, 72, 18, 18, { strokeColor: MERGED }),
    shape("merged", "ellipse", 70, 41, 18, 18, { strokeColor: MERGED }),
    arrow("join-one", 30, 19, [[0, 0], [24, 0], [24, 27]], { strokeColor: MERGED }),
    arrow("join-two", 30, 81, [[0, 0], [24, 0], [24, -27]], { strokeColor: MERGED }),
  ],
  "pull-request-closed": [
    ...pullRequestStem({ strokeColor: CLOSED }),
    ...cross(64, 16, { strokeColor: CLOSED }),
    arrow("branch", 28, 62, [[0, 0], [21, 0], [21, -20]], { strokeColor: CLOSED }),
  ],
  revision: [...revisionInk(), line("body-one", 28, 60, [[0, 0], [44, 0]]), line("body-two", 28, 74, [[0, 0], [30, 0]])],
  "revision-accepted": [
    ...revisionInk({ strokeColor: ACCEPTED }),
    line("check", 28, 56, [[0, 0], [16, 18], [34, -26]], { strokeColor: ACCEPTED, strokeWidth: 3 }),
  ],
  "revision-closed": [...revisionInk({ strokeColor: CLOSED }), ...cross(38, 54, { strokeColor: CLOSED })],
  commit: [
    line("history", 4, 50, [[0, 0], [92, 0]]),
    shape("commit-dot", "ellipse", 36, 36, 28, 28, { backgroundColor: INK, fillStyle: "solid" }),
  ],
};

/** Returns one starter icon as a complete Excalidraw scene. */
export function starterMapIconScene(name) {
  const elements = STARTER_ICON_ELEMENTS[name];
  if (!elements) return null;
  return {
    type: "excalidraw", version: 2, source: "https://tangent.local/map-icons",
    elements: elements.map((element, index) => ({ ...element, id: `${name}-${index}-${element.id}` })),
    appState: { viewBackgroundColor: "#ffffff" }, files: {},
  };
}

/** Returns every starter icon as a `<name>.excalidraw` file body. */
export function starterMapIconFiles() {
  return Object.keys(STARTER_ICON_ELEMENTS).map((name) => ({
    name,
    file: `${name}.excalidraw`,
    text: `${JSON.stringify(starterMapIconScene(name), null, 2)}\n`,
  }));
}

/** The starter definition Tangent writes when `map-kinds.md` is missing. */
export const MAP_KINDS_STARTER_TEXT = `# Map kinds

This Document decides what each kind of thing looks like on a Map, and what
one click does with it. Tangent wrote it once. It is yours now: Tangent never
rewrites it.

One entry per kind.

- \`id\`: the kind. Built-in ids are worktree, repository, link, github-pr,
  phabricator-revision, commit, goal, document, area, brain, and agent.
- \`label\`: the kind word in the accessible name, the Outline, and the
  Resources panel.
- \`target\`: \`path\`, \`url\`, or \`vault\`. A new id needs one.
- \`icon\`: the default icon name, a file in \`map-icons/\`.
- \`icons\`: an ordered list of \`{ "when": "<state>", "icon": "<name>" }\`. The
  first state that is true wins; otherwise \`icon\` wins.
- \`click\`: the action Enter, a double click, or the action button runs. A path
  allows \`copy-path\` and \`details\`, a URL allows \`open\` and \`details\`, a vault
  record allows \`open-document\`, \`open-goal\`, and \`open-brain\`.

A kind with no icon stays a card with the kind word on it. A problem in this
file never hides a Block: the kind falls back to a card and the Map says what
is wrong.

Edit a drawing in \`map-icons/\` with Excalidraw, or drop a library item there.
The next Map load shows it.

\`\`\`tangent.map-kinds.v1
{
  "version": 1,
  "kinds": [
    { "id": "worktree", "label": "Worktree", "icon": "worktree",
      "icons": [
        { "when": "missing", "icon": "worktree-missing" },
        { "when": "dirty", "icon": "worktree-dirty" }
      ],
      "click": "copy-path" },
    { "id": "repository", "label": "Repository", "icon": "repository",
      "icons": [ { "when": "missing", "icon": "repository-missing" } ],
      "click": "copy-path" },
    { "id": "link", "label": "Link", "icon": "link", "click": "open" },
    { "id": "github-pr", "label": "GitHub PR", "icon": "pull-request",
      "icons": [
        { "when": "success", "icon": "pull-request-merged" },
        { "when": "muted", "icon": "pull-request-closed" }
      ],
      "click": "open" },
    { "id": "phabricator-revision", "label": "Phabricator revision", "icon": "revision",
      "icons": [
        { "when": "success", "icon": "revision-accepted" },
        { "when": "muted", "icon": "revision-closed" }
      ],
      "click": "open" },
    { "id": "commit", "label": "Commit", "icon": "commit" }
  ]
}
\`\`\`
`;

export default { MAP_KINDS_STARTER_TEXT, starterMapIconFiles, starterMapIconScene };
