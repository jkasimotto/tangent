import { mount, unmount } from "svelte";

import App from "./App.svelte";
import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-light.css";
import "./app.css";

/** Mounts the Work app into the combined Tangent UI shell. */
export function mountApp(target: HTMLElement): () => void {
  target.classList.add("work-embedded-host");
  const app = mount(App, { target });
  return () => {
    target.classList.remove("work-embedded-host");
    void unmount(app);
  };
}
