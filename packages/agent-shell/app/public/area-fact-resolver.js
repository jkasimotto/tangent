  const geometry = (node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height });

  function resolveFileNode(node, documents) {
    const before = geometry(node);
    const document = documents.find((item) => item.file === node.file);
    const fact = document
      ? { ghost: false, kind: document.kind || (document.goal ? "goal" : "document"), title: document.title || node.file, status: document.status || "", summary: document.doneWhen || document.summary || "", source: { file: node.file, ...(node.subpath ? { subpath: node.subpath } : {}) } }
      : { ghost: true, kind: "missing", title: node.file, status: "missing", summary: "This reference is not in the current vault projection.", source: { file: node.file, ...(node.subpath ? { subpath: node.subpath } : {}) } };
    return { node, fact, geometry: before };
  }

  function resolveCanvas(canvas, documents) {
    return canvas.nodes.map((node) => node.type === "file" ? resolveFileNode(node, documents) : { node, fact: null, geometry: geometry(node) });
  }

export { resolveCanvas, resolveFileNode };
export default { resolveCanvas, resolveFileNode };
