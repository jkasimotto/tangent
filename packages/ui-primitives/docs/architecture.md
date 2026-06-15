# @tangent/ui-primitives Architecture

The package provides accessible controls with stable class names and semantic token styling. Complex interactive controls use React Aria Components so keyboard and screen-reader behavior is not hand-rolled.

Rules:
- No product domain imports.
- All interactive states must have focus-visible styling.
- Product-specific composition belongs in `@tangent/ui-components` or `@tangent/ui-patterns`.
