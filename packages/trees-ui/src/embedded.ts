import App from "./App.svelte";
import { mount, unmount } from "svelte";

import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-light.css";
import "./app.css";

export type EmbeddedAppContext = {
  appId: string;
};

/** Mounts the Trees app into the combined Tangent UI shell. */
export function mountApp(target: HTMLElement, _context?: EmbeddedAppContext): () => void {
  target.classList.add("trees-embedded-host");
  const app = mount(App, { target });
  return () => {
    target.classList.remove("trees-embedded-host");
    void unmount(app);
  };
}
