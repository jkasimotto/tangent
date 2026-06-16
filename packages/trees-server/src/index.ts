import type { LocalUiApp, StaticAssetMount, UiRoute } from "@tangent/ui-server";
import { treesUiEmbeddedAssets } from "@tangent/trees-ui/assets";

export type TreesUiApp = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
};

/** Creates a Trees app registration for the combined Tangent UI. */
export function createTreesUiApp(): TreesUiApp {
  return {
    app: {
      id: "trees",
      label: "Trees",
      routePath: "/trees",
      modulePath: "/apps/trees/embedded.js",
      stylePaths: ["/apps/trees/embedded.css"]
    },
    routes: [],
    assetMounts: [{ pathPrefix: "/apps/trees", assets: treesUiEmbeddedAssets }]
  };
}
