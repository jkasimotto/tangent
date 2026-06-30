import App from "./App.svelte";
import { mount, unmount } from "svelte";
import type { UsageUiClient } from "@tangent/usage-ui-data";

export type UsageMountOptions = {
  client?: UsageUiClient;
  embedded?: boolean;
};

/** Mounts the Usage Svelte app into a provided host element. */
export function mountUsageApp(target: HTMLElement, options: UsageMountOptions = {}): () => void {
  target.classList.add("usage-ui-host");
  target.classList.toggle("usage-embedded-host", Boolean(options.embedded));
  target.classList.toggle("usage-standalone-host", !options.embedded);
  const app = options.client ? mount(App, { target, props: { client: options.client } }) : mount(App, { target });
  return () => {
    target.classList.remove("usage-ui-host", "usage-embedded-host", "usage-standalone-host");
    void unmount(app);
  };
}
