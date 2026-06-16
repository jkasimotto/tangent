import { mountUsageApp } from "./mount.js";

import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-light.css";
import "./app.css";

export type EmbeddedAppContext = {
  appId: string;
};

/** Mounts Usage into an existing Tangent shell host. */
export function mountApp(target: HTMLElement, _context?: EmbeddedAppContext): () => void {
  return mountUsageApp(target, { embedded: true });
}
