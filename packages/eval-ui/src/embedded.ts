import App from "./App.svelte";
import { mount, unmount } from "svelte";

import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-light.css";
import "./app.css";

export type EmbeddedAppContext = {
  appId: string;
};

/** Mounts the Eval UI into a combined Tangent UI host. */
export function mountApp(target: HTMLElement, _context?: EmbeddedAppContext): () => void {
  target.classList.add("eval-embedded-host");
  const app = mount(App, { target });
  return () => {
    target.classList.remove("eval-embedded-host");
    void unmount(app);
  };
}
