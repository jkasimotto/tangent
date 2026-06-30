# @tangent/ui-tokens Architecture

This package has no React or product runtime. It owns token values and CSS custom properties consumed by all Tangent UI packages.

Rules:
- Use semantic token names such as `color.accent`, `color.danger`, and `color.diffAdd`.
- Do not add package-specific aliases such as `--bad`, `--warn`, or local product accents.
- Density is expressed through `data-density="compact|comfortable|spacious"`.
