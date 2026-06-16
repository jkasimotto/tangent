import App from "./App.svelte";
import { mount } from "svelte";

import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-light.css";
import "./app.css";

mount(App, { target: document.getElementById("root")! });
