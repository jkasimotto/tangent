import App from "./App.svelte";
import { mount } from "svelte";

import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-light.css";
import "./app.css";

mount(App, { target: document.getElementById("root")! });

// Register the service worker so Tangent can be installed as a standalone PWA window
// (its own dock icon, out of the browser tab strip). The worker does not cache; see public/sw.js.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
