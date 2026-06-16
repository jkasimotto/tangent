import { randomBytes } from "node:crypto";
import type http from "node:http";

import { createLocalUiServer, type LocalUiServer } from "@tangent/ui-server";
import { treesUiAssets } from "@tangent/trees-ui/assets";
import { buildTreesCenterView } from "@tangent/trees-ui-data";
import type { TreesClient } from "@tangent/trees-core";
import { openFsTrees } from "@tangent/trees-store-fs";

export type StartTreesUiServerOptions = {
  client?: TreesClient;
  storeRoot?: string;
  host?: string;
  port?: number;
  open?: boolean;
  selectedPath?: string;
};

export type TreesUiServer = LocalUiServer & {
  token: string;
};

/** Documents the startTreesUiServer helper. */
export async function startTreesUiServer(options: StartTreesUiServerOptions = {}): Promise<TreesUiServer> {
  const host = options.host || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn("warning: Tangent Center is binding outside loopback; protect this local automation surface.");
  }
  const client = options.client || await openFsTrees({ root: options.storeRoot });
  const token = randomBytes(18).toString("hex");
  const server = await createLocalUiServer({
    product: "trees",
    host,
    port: options.port ?? 0,
    open: false,
    assets: treesUiAssets,
    routes: [{
      method: "GET",
      pattern: /^\/api\/trees\/center$/,
      /** Documents the handle helper. */
      async handle(request, url) {
        if (!authorized(request, url, token)) return { status: 401, json: { error: "Unauthorized." } };
        const projection = await client.projection();
        return { json: buildTreesCenterView(projection, { selectedRef: url.searchParams.get("path") || options.selectedPath || undefined }) };
      }
    }]
  });
  const url = withToken(server.url, token);
  if (options.open) {
    const { openBrowser } = await import("@tangent/ui-server");
    openBrowser(url);
  }
  return {
    ...server,
    url,
    token
  };
}

/** Documents the authorized helper. */
function authorized(request: http.IncomingMessage, url: URL, token: string): boolean {
  return url.searchParams.get("token") === token || request.headers.authorization === `Bearer ${token}`;
}

/** Documents the withToken helper. */
function withToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("token", token);
  return parsed.toString();
}
