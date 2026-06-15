import { appCompareJs } from "./static-app-compare.js";
import { appShellJs } from "./static-app-shell.js";
import { indexHtml, stylesCss } from "./static-assets.js";

const appJs = `${appShellJs}\n${appCompareJs}`;

/** Returns the static eval UI asset for a request path. */
export function staticResponse(pathname: string): { contentType: string; body: string } | undefined {
  if (pathname !== "/" && pathname !== "/index.html" && pathname !== "/app.js" && pathname !== "/styles.css") return undefined;
  if (pathname === "/app.js") return { contentType: "text/javascript; charset=utf-8", body: appJs };
  if (pathname === "/styles.css") return { contentType: "text/css; charset=utf-8", body: stylesCss };
  return { contentType: "text/html; charset=utf-8", body: indexHtml };
}
