// The starter Map kinds definition. Tangent writes it into the vault once,
// when the definition file is missing, and never rewrites it: from then on
// Julian owns it. Tangent writes no icon file. Icons are files Julian puts in
// `map-icons/` himself, an image or an Excalidraw drawing, and the definition
// names them there. The starter therefore names no icon, so a fresh vault
// loads its Map with every kind as a card and no problem line.
// Design: docs/design/map-resource-icons/product.md

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
- \`icon\`: the default icon name, a file in \`map-icons/\`. The name is the file
  name without its extension.
- \`icons\`: an ordered list of \`{ "when": "<state>", "icon": "<name>" }\`. The
  first state that is true wins; otherwise \`icon\` wins.
- \`click\`: the action Enter, a double click, or the action button runs. A path
  allows \`copy-path\` and \`details\`, a URL allows \`open\` and \`details\`, a vault
  record allows \`open-document\`, \`open-goal\`, and \`open-brain\`.

A kind with no icon stays a card with the kind word on it. A problem in this
file never hides a Block: the kind falls back to a card and the Map says what
is wrong.

Tangent draws no icon of its own, so no entry below names one and every kind
starts as a card. Put a file in \`map-icons/\`, then add \`"icon": "<its name>"\`
to its entry here, and the next Map load draws it.

An icon file is an image (\`.png\`, \`.svg\`, \`.webp\`, \`.jpg\`) or an Excalidraw
drawing (\`.excalidraw\`, \`.excalidrawlib\`). Edit a drawing with Excalidraw, or
drop an image in. The next Map load shows it, with no restart. If a name has
both an image and a drawing, the Map draws the image and says so.

Draw an image large: at least 512 pixels on its long edge, because the Map
zooms and a small picture goes soft. An \`.svg\` needs no size of its own; the
Map draws it at 512 pixels or at its own size, whichever is larger. One file is
at most 2 MB.

The Map is a dark canvas, and it lightens a very saturated colour a little,
the same way it does the ink of a drawing.

\`\`\`tangent.map-kinds.v1
{
  "version": 1,
  "kinds": [
    { "id": "worktree", "label": "Worktree", "click": "copy-path" },
    { "id": "repository", "label": "Repository", "click": "copy-path" },
    { "id": "link", "label": "Link", "click": "open" },
    { "id": "github-pr", "label": "GitHub PR", "click": "open" },
    { "id": "phabricator-revision", "label": "Phabricator revision", "click": "open" },
    { "id": "commit", "label": "Commit" }
  ]
}
\`\`\`
`;

export default { MAP_KINDS_STARTER_TEXT };
