// Renders a PolicySection['body'] from @ccc/shared (legal.ts / terms.ts): a
// small markdown dialect of bold, inline code, dash bullets and pipe tables.
// Mirrors apps/mobile/src/legal/PolicyBody.tsx's parser so both platforms
// read the same source text the same way; the output here is plain HTML
// (table element, not RN views) since this renders on the web.
type Segment =
  | { kind: 'text'; line: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function parseSegments(text: string): Segment[] {
  const lines = text.split('\n');
  const segments: Segment[] = [];
  let tableLines: string[] = [];

  const flushTable = () => {
    if (tableLines.length < 3) {
      tableLines.forEach((l) => segments.push({ kind: 'text', line: l }));
      tableLines = [];
      return;
    }
    const parseRow = (l: string) =>
      l
        .split('|')
        .filter((_, i, a) => i > 0 && i < a.length - 1)
        .map((c) => c.trim());

    const [headerLine, , ...dataLines] = tableLines;
    const headers = parseRow(headerLine ?? '');
    const rows = dataLines.map(parseRow);
    segments.push({ kind: 'table', headers, rows });
    tableLines = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('|')) {
      tableLines.push(line);
    } else {
      if (tableLines.length) flushTable();
      if (line.trim()) segments.push({ kind: 'text', line });
    }
  }
  if (tableLines.length) flushTable();
  return segments;
}

function stripMd(s: string) {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

export function PolicyBody({ text }: { text: string }) {
  const segments = parseSegments(text);

  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) => {
        if (seg.kind === 'table') {
          return (
            <div key={i} className="my-2 overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {seg.headers.map((header, hi) => (
                      <th
                        key={hi}
                        className="border-b border-border bg-surface-alt px-3 py-2 text-left font-semibold text-fg"
                      >
                        {stripMd(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seg.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border last:border-0">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 align-top text-fg-secondary">
                          {stripMd(cell ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        const line = seg.line;
        if (line.startsWith('- ')) {
          return (
            <p key={i} className="pl-4 text-sm text-fg-secondary">
              {'• '}
              {stripMd(line.slice(2))}
            </p>
          );
        }
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <p key={i} className="mt-2 text-sm font-semibold text-fg">
              {line.replace(/\*\*/g, '')}
            </p>
          );
        }
        return (
          <p key={i} className="text-sm text-fg-secondary">
            {stripMd(line)}
          </p>
        );
      })}
    </div>
  );
}
