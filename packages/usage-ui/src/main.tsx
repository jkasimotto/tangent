import React from "react";
import { createRoot } from "react-dom/client";

import "@tangent/ui-tokens/css/tokens.css";
import "@tangent/ui-tokens/css/theme-system.css";
import "@tangent/ui-primitives/styles.css";
import "@tangent/ui-components/styles.css";
import "@tangent/ui-patterns/styles.css";
import "@tangent/ui-charts/styles.css";
import "@tangent/ui-code/styles.css";
import "@tangent/ui-app-shell/styles.css";

import { UsageApp } from "./app/UsageApp.js";

createRoot(document.getElementById("root")!).render(<UsageApp />);
