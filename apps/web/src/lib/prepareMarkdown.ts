function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nonempty = lines.filter((line) => line.trim().length > 0);
  if (nonempty.length === 0) return text.trim();
  const pad = Math.min(...nonempty.map((line) => line.match(/^ */)?.[0].length ?? 0));
  if (pad < 2) return text.trim();
  return lines.map((line) => line.slice(pad)).join('\n').trim();
}

function unwrapFences(text: string): string {
  let next = text.trim();
  for (let i = 0; i < 3; i += 1) {
    const fenced = next.match(/^```[a-zA-Z0-9_-]*[ \t]*\n([\s\S]*?)\n```[ \t]*$/);
    if (!fenced) break;
    next = fenced[1].trim();
  }
  return next;
}

function pullText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    return value.map(pullText).filter(Boolean).join('\n\n');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.text === 'string') return row.text;
  if (row.message) return pullText(row.message);
  if (row.content) return pullText(row.content);
  return '';
}

/** Agent output is often fenced, indented, or JSON-wrapped markdown source. */
export function prepareMarkdown(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.trim()) return '';

  if (
    (text.trimStart().startsWith('{') && text.trimEnd().endsWith('}'))
    || (text.trimStart().startsWith('[') && text.trimEnd().endsWith(']'))
  ) {
    try {
      const pulled = pullText(JSON.parse(text));
      if (pulled.trim()) text = pulled;
    } catch { /* keep the original string */ }
  }

  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const inner = JSON.parse(text);
      if (typeof inner === 'string' && inner.trim()) text = inner;
    } catch { /* keep */ }
  }

  const realBreaks = (text.match(/\n/g) ?? []).length;
  const escaped = (text.match(/\\n/g) ?? []).length;
  if (realBreaks < 2 && escaped >= 2) {
    text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }

  text = unwrapFences(text);
  text = dedent(text);
  // GFM tables need a blank line before the header row.
  text = text.replace(/([^\n])\n(\|[^\n]+\|\s*\n\s*\|[-:| ]+\|)/g, '$1\n\n$2');

  const heading = text.search(/^#{1,6}\s/m);
  if (heading > 0 && /AgentResult|stop_reason|"role":\s*"assistant"/.test(text.slice(0, heading))) {
    text = text.slice(heading).trim();
  }

  return text.trim();
}
