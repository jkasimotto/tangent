# Agent Notes

Purpose: @tangent/eval report source area: the report view-model (`model.ts`) assembled from a run's sidecars, and the markdown (`markdown.ts`) and HTML (`html*.ts`) renderers over it.

Local rules:
- One view-model, two renderers: change `model.ts` when the data a report shows should change; change `markdown.ts` or `html*.ts` when only the presentation should change.
- `buildReportModel` is pure (no file or git I/O); `loadReportModel` is the only async, disk-reading entry point. Keep that split so the renderers and the model's sorting/delta rules stay unit-testable without fixture files.
- No HTML tags in `markdown.ts` output. No em dashes anywhere, including inside rendered templates.
- `html.ts` and its helpers must render one self-contained document: inline CSS, zero external requests, and any interpolated free text (judge reasoning, transcript prose, tool-call previews) escaped via `html-escape.ts`.

Read next:
- ../../docs/index.md
- ../../docs/architecture.md
- ../../docs/public-api.md
- ../../../../docs/superpowers/specs/2026-07-05-mark-loop-design.md
