import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".map": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const VENDORS = {
  "/vendor/d3/": {
    "d3-dispatch.min.js": "d3-dispatch/dist/d3-dispatch.min.js",
    "d3-quadtree.min.js": "d3-quadtree/dist/d3-quadtree.min.js",
    "d3-timer.min.js": "d3-timer/dist/d3-timer.min.js",
    "d3-force.min.js": "d3-force/dist/d3-force.min.js",
  },
  "/vendor/xterm/": {
    "xterm.js": "@xterm/xterm/lib/xterm.js", "xterm.css": "@xterm/xterm/css/xterm.css",
    "addon-fit.js": "@xterm/addon-fit/lib/addon-fit.js", "addon-webgl.js": "@xterm/addon-webgl/lib/addon-webgl.js",
  },
};

/** Serves one Agent Shell or allowlisted vendor asset without caching it. */
export async function serveStaticAsset(url, response, root) {
  try {
    let file;
    if (url.pathname === "/" || url.pathname === "/index.html") file = path.join(root, "public", "shell.html");
    else {
      const browserAsset = url.pathname === "/agent-shell-map.js" || url.pathname === "/agent-shell-map.css" || url.pathname.startsWith("/agent-shell-map-assets/");
      if (browserAsset) {
        const relative = path.normalize(url.pathname).replace(/^[/\\]+/, "");
        file = path.join(root, "..", "dist", "browser", relative);
      } else {
        const vendor = Object.entries(VENDORS).find(([prefix]) => url.pathname.startsWith(prefix));
        if (vendor) {
          const [prefix, files] = vendor;
          const relative = files[url.pathname.slice(prefix.length)];
          if (!relative) return notFound(response);
          file = path.join(root, "node_modules", relative);
        } else {
          const relative = path.normalize(url.pathname).replace(/^([.][.][/\\])+/, "");
          file = path.join(root, "public", relative);
        }
      }
    }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    response.end(body);
  } catch {
    notFound(response);
  }
}

/** Ends one static request as not found. */
function notFound(response) {
  response.writeHead(404).end("not found");
}
