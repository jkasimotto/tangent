export const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tangent Eval</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`;

export const stylesCss = `
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --sidebar: #fafbfc;
  --surface: #ffffff;
  --surface-2: #eef1f4;
  --surface-3: #f8fafc;
  --text: #16181d;
  --muted: #66707c;
  --line: #d6dce3;
  --accent: #2563eb;
  --accent-soft: #e8f0ff;
  --good: #0f766e;
  --good-soft: #e8f7f1;
  --bad: #b42318;
  --bad-soft: #fff0ed;
  --warn: #a15c07;
  --warn-soft: #fff7e6;
  --code-bg: #fbfcfe;
  --diff-add: #e9f8ef;
  --diff-del: #fff0ee;
  --diff-hunk: #edf5ff;
  --diff-meta: #f0f2f5;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, select, textarea, input { font: inherit; }
button, select { min-height: 32px; border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: 6px; padding: 0 10px; }
button { cursor: pointer; }
button:disabled { opacity: 0.55; cursor: not-allowed; }
button.primary { border-color: var(--accent); background: var(--accent); color: white; }
button.danger { border-color: var(--bad); color: var(--bad); background: var(--bad-soft); }
.shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
.sidebar { border-right: 1px solid var(--line); padding: 16px 12px; background: var(--sidebar); overflow: auto; }
.brand { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
.nav-section { margin: 14px 0 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.nav-heading { font-size: 11px; font-weight: 750; letter-spacing: 0; text-transform: uppercase; color: var(--muted); }
.run-list { display: grid; gap: 6px; }
.run-row { width: 100%; text-align: left; padding: 9px 10px; height: auto; border-color: transparent; background: transparent; }
.run-row:hover, .run-row.selected { background: var(--surface-2); border-color: var(--line); }
.run-name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-meta, .muted { color: var(--muted); font-size: 12px; }
.error-text { color: var(--bad); }
.main { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
.topbar { padding: 16px 22px 10px; border-bottom: 1px solid var(--line); background: rgba(245,246,248,0.94); position: sticky; top: 0; z-index: 3; backdrop-filter: blur(8px); }
.title { display: flex; gap: 12px; align-items: baseline; min-width: 0; }
.title h1 { font-size: 20px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.spec-workspace { min-height: 0; padding: 14px 22px 22px; display: grid; gap: 14px; overflow: auto; }
.split { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr); gap: 14px; align-items: start; }
.section-panel { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; min-width: 0; }
.section-title { padding: 9px 11px; border-bottom: 1px solid var(--line); background: var(--surface-3); font-weight: 700; font-size: 13px; display: flex; justify-content: space-between; gap: 10px; }
.detail-body { padding: 11px; display: grid; gap: 10px; }
.kv { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 7px 10px; font-size: 13px; }
.kv div:nth-child(odd) { color: var(--muted); }
.code-inline { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-word; }
.prompt-preview { max-height: 420px; background: var(--code-bg); }
.job-strip { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; display: grid; gap: 0; }
.job-head { padding: 10px 12px; display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid var(--line); background: var(--surface-3); }
.job-title { display: grid; gap: 2px; min-width: 0; }
.timeline { margin: 0; padding: 10px 12px 10px 28px; max-height: 180px; overflow: auto; color: var(--muted); font-size: 12px; line-height: 1.45; }
.timeline li { margin: 0 0 4px; }
.log-tail { max-height: 240px; border-top: 1px solid var(--line); background: #101418; color: #dce6ef; }
.cases { padding: 10px 22px; border-bottom: 1px solid var(--line); display: grid; gap: 10px; max-height: 210px; overflow: auto; background: var(--surface-3); }
.case-block { display: grid; gap: 7px; }
.case-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: top; }
th { background: #edf0f3; color: #343941; font-weight: 650; }
tr:last-child td { border-bottom: 0; }
tr.selected-variant td { background: #f7fbff; }
.compare { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.summary { padding: 12px 22px; background: var(--surface); border-bottom: 1px solid var(--line); display: grid; gap: 10px; }
.summary-head { display: flex; justify-content: space-between; gap: 16px; align-items: end; min-width: 0; }
.summary-title { min-width: 0; }
.summary-title h2 { margin: 2px 0 0; font-size: 16px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eyebrow { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
.phase-chip { border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px; color: var(--muted); background: var(--surface-3); font-size: 12px; white-space: nowrap; }
.summary-wrap { overflow-x: auto; }
.summary-table { min-width: 680px; }
.summary-table th:first-child, .summary-table td:first-child { width: 180px; color: var(--muted); }
.metric-value { font-weight: 700; white-space: nowrap; }
.delta { font-weight: 700; white-space: nowrap; }
.delta-good { color: var(--good); background: var(--good-soft); }
.delta-bad { color: var(--bad); background: var(--bad-soft); }
.delta-neutral { color: var(--muted); }
.workspace { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); padding: 0 22px 22px; }
.tabs { display: flex; gap: 4px; padding: 12px 0 10px; overflow-x: auto; }
.tabs button.active { background: var(--accent-soft); border-color: var(--accent); }
.pane-grid { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.pane, .single-pane, .diff-pane { min-height: 0; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.pane-title { padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--surface-3); font-weight: 650; font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }
pre { margin: 0; padding: 12px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.diff-code { padding: 0; background: var(--code-bg); white-space: pre; word-break: normal; line-height: 1.48; }
.diff-line { display: block; min-height: 18px; padding: 0 12px; border-left: 3px solid transparent; }
.diff-add { background: var(--diff-add); color: #14532d; border-left-color: var(--good); }
.diff-del { background: var(--diff-del); color: #7f1d1d; border-left-color: var(--bad); }
.diff-hunk { background: var(--diff-hunk); color: #1d4ed8; font-weight: 650; }
.diff-meta { background: var(--diff-meta); color: #343941; font-weight: 650; }
.diff-warn { background: var(--warn-soft); color: var(--warn); }
.single-pane { min-height: 360px; }
.files { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.file-list { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; }
.file-list h3 { margin: 0; padding: 8px 10px; font-size: 13px; background: var(--surface-3); border-bottom: 1px solid var(--line); }
.file-list ul { margin: 0; padding: 8px 10px 10px 24px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.empty { color: var(--muted); padding: 24px; }
.status-done { color: var(--good); font-weight: 650; }
.status-failed { color: var(--bad); font-weight: 650; }
.status-cancelled { color: var(--bad); font-weight: 650; }
.status-running, .status-prepared, .status-manual { color: var(--warn); font-weight: 650; }
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--line); max-height: 220px; }
  .summary-head { align-items: start; flex-direction: column; }
  .split { grid-template-columns: 1fr; }
  .pane-grid, .files { grid-template-columns: 1fr; }
}
`;
