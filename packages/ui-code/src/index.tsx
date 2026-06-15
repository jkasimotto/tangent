import React, { type ReactNode } from "react";
import { Badge, Button, Disclosure } from "@tangent/ui-primitives";
import type { ActionModel, MetricValue } from "@tangent/ui-components";

export type ToolCallSummary = {
  id: string;
  name: string;
  status?: string;
  durationMs?: number;
  target?: string;
};

export type TranscriptMessageProps = {
  role: "user" | "assistant" | "system" | "tool";
  at?: string;
  title?: string;
  text?: string;
  textPreview?: string;
  tokens?: MetricValue;
  toolCalls?: ToolCallSummary[];
  confidence?: string;
  actions?: ActionModel[];
  defaultExpanded?: boolean;
};

/** Renders the CodeBlock UI. */
export function CodeBlock({ code, language }: { code: string; language?: string }): React.ReactElement {
  return <pre className="tg-code-block" data-language={language}><code>{code}</code></pre>;
}

/** Renders the DiffViewer UI. */
export function DiffViewer({ diff }: { diff: string }): React.ReactElement {
  const rows = diff.split("\n");
  return (
    <pre className="tg-diff-viewer">
      {rows.map((line, index) => <code key={`${index}:${line}`} data-kind={lineKind(line)}>{line || " "}</code>)}
    </pre>
  );
}

export const UnifiedDiffViewer = DiffViewer;

/** Renders the SideBySideDiffViewer UI. */
export function SideBySideDiffViewer({ left, right }: { left?: string; right?: string }): React.ReactElement {
  return <div className="tg-side-by-side"><DiffViewer diff={left || ""} /><DiffViewer diff={right || ""} /></div>;
}

/** Renders the MarkdownBlock UI. */
export function MarkdownBlock({ markdown }: { markdown: string }): React.ReactElement {
  return <div className="tg-markdown-block">{markdown.split(/\n{2,}/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>;
}

/** Renders the TranscriptMessage UI. */
export function TranscriptMessage({
  role,
  at,
  title,
  text,
  textPreview,
  tokens,
  toolCalls = [],
  confidence,
  actions = []
}: TranscriptMessageProps): React.ReactElement {
  const body = text ?? textPreview ?? "";
  const shouldCollapse = body.length > 900 || toolCalls.length > 0;
  return (
    <article className="tg-transcript-message" data-role={role}>
      <header className="tg-transcript-message__header">
        <Badge tone={role === "assistant" ? "accent" : role === "tool" ? "info" : "neutral"}>{role}</Badge>
        {title ? <strong>{title}</strong> : null}
        {at ? <span>{at}</span> : null}
        {confidence ? <Badge tone="info">{confidence}</Badge> : null}
      </header>
      {shouldCollapse ? (
        <Disclosure title="Message preview">
          <MarkdownBlock markdown={body} />
        </Disclosure>
      ) : <MarkdownBlock markdown={body} />}
      {tokens ? <p className="tg-transcript-message__meta">{tokens.label}: {tokens.value}</p> : null}
      {toolCalls.length ? <ToolCallBlock calls={toolCalls} /> : null}
      {actions.length ? <footer>{actions.map((action) => <Button key={action.id || action.label} variant="ghost" onClick={action.onAction}>{action.label}</Button>)}</footer> : null}
    </article>
  );
}

/** Renders the ToolCallBlock UI. */
export function ToolCallBlock({ calls }: { calls: ToolCallSummary[] }): React.ReactElement {
  return (
    <Disclosure title={`Tool calls (${calls.length})`}>
      <ul className="tg-tool-call-list">
        {calls.map((call) => <li key={call.id}><strong>{call.name}</strong> {call.status || "unknown"} {call.target || ""}</li>)}
      </ul>
    </Disclosure>
  );
}

/** Renders the JsonInspector UI. */
export function JsonInspector({ value }: { value: unknown }): React.ReactElement {
  return <CodeBlock language="json" code={JSON.stringify(value, null, 2)} />;
}

/** Renders the FileTree UI. */
export function FileTree({ files }: { files: string[] }): React.ReactElement {
  return <ul className="tg-file-tree">{files.map((file) => <li key={file}>{file}</li>)}</ul>;
}

/** Supports the line kind helper. */
function lineKind(line: string): "add" | "delete" | "meta" | "context" {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "delete";
  if (line.startsWith("@@") || line.startsWith("diff ")) return "meta";
  return "context";
}

/** Renders the OutputCompare UI. */
export function OutputCompare({ left, right }: { left?: ReactNode; right?: ReactNode }): React.ReactElement {
  return <div className="tg-side-by-side"><section>{left}</section><section>{right}</section></div>;
}
