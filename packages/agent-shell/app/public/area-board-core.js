  /** Returns the board-coordinate center of one node. */
  const center = (node) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  /** Clones authored canvas data before an immutable edit. */
  const clone = (canvas) => structuredClone(canvas);

  /** Tests center-point membership in a standard group node. */
  function contains(group, node) {
    const point = center(node);
    return node.id !== group.id && point.x >= group.x && point.x <= group.x + group.width && point.y >= group.y && point.y <= group.y + group.height;
  }

  /** Lists every standard group that contains a node. */
  function groupsForNode(canvas, nodeId) {
    const node = canvas.nodes.find((item) => item.id === nodeId);
    return node ? canvas.nodes.filter((item) => item.type === "group" && contains(item, node)).map((item) => item.id) : [];
  }

  /** Orders nodes for spatial keyboard and screen-reader traversal. */
  function spatialOrder(nodes) {
    return [...nodes].sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  }

  /** Finds the nearest node in one requested spatial direction. */
  function directionalNode(nodes, fromId, direction) {
    const from = nodes.find((node) => node.id === fromId);
    if (!from) return null;
    const origin = center(from);
    const candidates = nodes.filter((node) => node.id !== fromId).map((node) => {
      const point = center(node); const dx = point.x - origin.x; const dy = point.y - origin.y;
      const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
      const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      return { node, primary, score: primary + cross * 0.35 };
    }).filter((item) => item.primary > 0).sort((left, right) => left.score - right.score || left.node.id.localeCompare(right.node.id));
    return candidates[0]?.node ?? null;
  }

  /** Applies the allowed mutable fields without changing node identity or order. */
  function updateNode(canvas, id, patch) {
    const next = clone(canvas); const node = next.nodes.find((item) => item.id === id);
    if (!node) return next;
    for (const field of ["x", "y", "width", "height", "text", "label", "color"]) if (patch[field] !== undefined) node[field] = patch[field];
    return next;
  }

  /** Appends one authored node at the top of the z-order. */
  function addNode(canvas, node) { const next = clone(canvas); next.nodes.push(structuredClone(node)); return next; }
  /** Appends one authored edge. */
  function addEdge(canvas, edge) { const next = clone(canvas); next.edges.push(structuredClone(edge)); return next; }
  /** Removes one node or edge and any edges attached to a removed node. */
  function removeItem(canvas, id) { const next = clone(canvas); next.nodes = next.nodes.filter((node) => node.id !== id); next.edges = next.edges.filter((edge) => edge.id !== id && edge.fromNode !== id && edge.toNode !== id); return next; }

  /** Promotes ink while preserving its identity, geometry, color, and z-order. */
  function replaceNodeWithReference(canvas, id, reference) {
    const next = clone(canvas); const index = next.nodes.findIndex((node) => node.id === id);
    if (index < 0) return next;
    const old = next.nodes[index];
    next.nodes[index] = { id: old.id, type: "file", file: reference.file, ...(reference.subpath ? { subpath: reference.subpath } : {}), x: old.x, y: old.y, width: old.width, height: old.height, ...(old.color ? { color: old.color } : {}) };
    return next;
  }

  /** Hides one node by moving its center into the standards-only Inbox group. */
  function moveIntoInbox(canvas, id) {
    const next = clone(canvas); const node = next.nodes.find((item) => item.id === id); const inbox = next.nodes.find((item) => item.id === "tangent-inbox-v1" && item.type === "group");
    if (!node || !inbox) return next;
    node.x = inbox.x + 16; node.y = inbox.y + 36;
    return next;
  }

  /** Shows one hidden node by moving it directly outside the Inbox group. */
  function moveOutOfInbox(canvas, id) {
    const next = clone(canvas); const node = next.nodes.find((item) => item.id === id); const inbox = next.nodes.find((item) => item.id === "tangent-inbox-v1" && item.type === "group");
    if (!node || !inbox || !contains(inbox, node)) return next;
    node.x = inbox.x - node.width - 40; node.y = inbox.y + 36;
    return next;
  }

  /** Adds the reserved standards-only Inbox group when it is absent. */
  function ensureInbox(canvas) {
    if (canvas.nodes.some((node) => node.id === "tangent-inbox-v1")) return clone(canvas);
    return addNode(canvas, { id: "tangent-inbox-v1", type: "group", label: "Inbox", x: 1900, y: 40, width: 420, height: 900 });
  }

  /** Derives hidden membership from the Inbox group's standard geometry. */
  function hiddenNodeIds(canvas) {
    const inbox = canvas.nodes.find((node) => node.id === "tangent-inbox-v1" && node.type === "group");
    return new Set(inbox ? canvas.nodes.filter((node) => contains(inbox, node)).map((node) => node.id) : []);
  }

const api = { addEdge, addNode, center, contains, directionalNode, ensureInbox, groupsForNode, hiddenNodeIds, moveIntoInbox, moveOutOfInbox, removeItem, replaceNodeWithReference, spatialOrder, updateNode };
export { addEdge, addNode, center, contains, directionalNode, ensureInbox, groupsForNode, hiddenNodeIds, moveIntoInbox, moveOutOfInbox, removeItem, replaceNodeWithReference, spatialOrder, updateNode };
export default api;
