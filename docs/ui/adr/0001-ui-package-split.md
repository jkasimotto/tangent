# ADR 0001: UI Package Split

Decision: split Tangent UI into tokens, primitives, components, patterns, charts, code renderers, app shell, UI-data packages, product UIs, and local servers.

Reason: Usage, Eval, and Rollup need one coherent interface without pushing React or UI dependencies into API-only consumers.
