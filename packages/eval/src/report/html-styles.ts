// Inline CSS for report.html. Values are copied from @tangent/ui-tokens (packages/ui-tokens/src/css/
// theme-light.css and theme-dark.css) rather than imported, because report.html must be one
// self-contained file with zero external requests and the tokens package ships CSS custom properties,
// not a JS-importable constant. Keep these values in sync by hand if ui-tokens' palette changes.

/**
 * Returns the full inline `<style>` block for report.html: CSS custom properties for light and dark
 * (via `prefers-color-scheme`, matching ui-tokens' theme-system.css), then the report's own layout
 * rules. At-a-glance rule: color encodes pass/fail only, so every other rule here uses neutral text,
 * border, and surface colors.
 */
export function reportStyleBlock(): string {
  return `<style>
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-inset: #f1f5f9;
  --text: #0f172a;
  --text-muted: #64748b;
  --border: #d9e2ec;
  --accent: #2563eb;
  --success: #15803d;
  --danger: #b91c1c;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1020;
    --surface: #111827;
    --surface-raised: #172033;
    --surface-inset: #0f172a;
    --text: #e5e7eb;
    --text-muted: #94a3b8;
    --border: #273449;
    --accent: #60a5fa;
    --success: #4ade80;
    --danger: #f87171;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.5rem 4rem;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
}
main { max-width: 72rem; margin: 0 auto; }
h1, h2, h3 { line-height: 1.25; }
h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
h3 { font-size: 0.95rem; margin: 0 0 0.25rem; }
code, .mono { font-family: var(--font-mono); font-size: 0.9em; }
a { color: var(--accent); }
.report-meta { color: var(--text-muted); font-size: 0.9rem; }
.report-meta div { margin: 0.15rem 0; }

table { border-collapse: collapse; width: 100%; background: var(--surface); }
th, td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; vertical-align: top; }
th { background: var(--surface-inset); font-weight: 600; }
.matrix td.verdict { text-align: center; font-weight: 600; }
.pass { color: var(--success); }
.fail { color: var(--danger); }
.absent { color: var(--text-muted); font-weight: 400; }
.baseline-col { background: var(--surface-inset); }
.discriminating-badge { font-size: 0.7rem; color: var(--text-muted); font-weight: 400; margin-left: 0.4rem; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.75rem; margin-top: 0.5rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem 0.9rem; }
.card.is-baseline { border-color: var(--accent); }
.card h3 { display: flex; align-items: center; gap: 0.4rem; }
.card .badge { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 0.05rem 0.4rem; }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.6rem; margin: 0.5rem 0 0; font-size: 0.85rem; }
.card dt { color: var(--text-muted); }
.card dd { margin: 0; text-align: right; }
.card .delta { color: var(--text-muted); font-size: 0.78rem; margin-left: 0.3rem; }

details.report-collapsible { background: var(--surface); border: 1px solid var(--border); border-radius: 0.4rem; margin: 0.4rem 0; padding: 0.1rem 0.75rem; }
details.report-collapsible > summary { cursor: pointer; padding: 0.5rem 0; font-weight: 500; list-style: none; }
details.report-collapsible > summary::-webkit-details-marker { display: none; }
details.report-collapsible > summary::before { content: "▸"; display: inline-block; width: 1rem; color: var(--text-muted); }
details.report-collapsible[open] > summary::before { content: "▾"; }
details.report-collapsible .body { padding: 0 0 0.75rem; }

.reasoning-row { display: grid; grid-template-columns: 8rem 1fr; gap: 0.3rem 0.75rem; padding: 0.2rem 0; font-size: 0.85rem; }
.reasoning-row .label { color: var(--text-muted); }

.diff-line { font-family: var(--font-mono); font-size: 0.8rem; white-space: pre-wrap; padding: 0 0.4rem; }
.diff-add { background: rgba(74, 222, 128, 0.15); }
.diff-delete { background: rgba(248, 113, 113, 0.15); }

.transcript-turn { border-left: 2px solid var(--border); padding: 0.25rem 0 0.25rem 0.6rem; margin: 0.35rem 0; }
.transcript-turn .role { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); }
.transcript-turn .text { white-space: pre-wrap; font-size: 0.88rem; }
.tool-call { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin: 0.15rem 0; }

.toolbar { display: flex; justify-content: flex-end; gap: 0.5rem; margin: 0.5rem 0; }
.toolbar button {
  font: inherit; font-size: 0.8rem; padding: 0.25rem 0.7rem; border-radius: 0.3rem;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer;
}
.warnings { color: var(--text-muted); font-size: 0.85rem; }
</style>`;
}
