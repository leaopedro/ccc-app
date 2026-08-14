import type React from 'react';

// Extracted from app/(public)/privacidade/page.tsx so the terms page renders the
// same markdown subset instead of duplicating the parser. Both documents come
// from @ccc/shared as PolicySection[] with a small dialect: bold, inline code,
// dash bullets and pipe tables.

export function PolicyBody({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let tableLines: string[] = [];
  let listLines: string[] = [];

  const flushTable = () => {
    if (tableLines.length < 3) {
      tableLines = [];
      return;
    }
    const rows = tableLines.map((l) =>
      l
        .split('|')
        .filter((_, i, a) => i > 0 && i < a.length - 1)
        .map((c) => c.trim()),
    );
    const [header, , ...body] = rows;
    if (!header) {
      tableLines = [];
      return;
    }
    elements.push(
      <div key={elements.length} className="overflow-x-auto">
        <table className="w-full text-sm border-collapse border border-[color:var(--color-border)]">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th
                  key={i}
                  className="border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-left font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border border-[color:var(--color-border)] px-3 py-2 align-top"
                    dangerouslySetInnerHTML={{ __html: renderInline(cell) }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableLines = [];
  };

  const flushList = () => {
    if (!listLines.length) return;
    elements.push(
      <ul key={elements.length} className="list-disc pl-5 space-y-1 text-sm">
        {listLines.map((l, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: renderInline(l.replace(/^-\s+/, '')) }} />
        ))}
      </ul>,
    );
    listLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('|')) {
      flushList();
      tableLines.push(line);
      continue;
    }
    if (tableLines.length) {
      flushTable();
    }
    if (line.startsWith('- ')) {
      listLines.push(line);
      continue;
    }
    flushList();
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(
        <p key={elements.length} className="font-semibold text-sm mt-4 mb-1">
          {line.replace(/\*\*/g, '')}
        </p>,
      );
    } else {
      elements.push(
        <p
          key={elements.length}
          className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }}
        />,
      );
    }
  }
  flushList();
  flushTable();

  return <div className="space-y-2">{elements}</div>;
}

function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="font-mono text-xs bg-gray-800 px-1 rounded">$1</code>');
}
