import { Text } from '@ccc/ui';
import { View } from 'react-native';

// Extracted from app/(auth)/privacidade.tsx so the terms screen renders the same
// markdown subset instead of duplicating ~150 lines of parser. Both documents
// come from @ccc/shared as PolicySection[] with a small markdown dialect: bold,
// inline code, dash bullets and pipe tables.

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
    <View>
      {segments.map((seg, i) => {
        if (seg.kind === 'table') {
          return (
            <View key={i} style={{ marginBottom: 8 }}>
              {seg.rows.map((row, ri) => (
                <View
                  key={ri}
                  style={{
                    borderWidth: 1,
                    borderColor: '#2a2a2a',
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 6,
                    backgroundColor: '#111',
                  }}
                >
                  {seg.headers.map((header, ci) => (
                    <View
                      key={ci}
                      style={{
                        flexDirection: 'row',
                        marginBottom: ci < seg.headers.length - 1 ? 4 : 0,
                      }}
                    >
                      <Text
                        variant="caption"
                        weight="semibold"
                        style={{ width: 90, flexShrink: 0, color: '#888' }}
                      >
                        {stripMd(header)}
                      </Text>
                      <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                        {stripMd(row[ci] ?? '')}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          );
        }

        const line = seg.line;
        if (line.startsWith('- ')) {
          return (
            <Text key={i} variant="bodySm" tone="secondary" style={{ marginBottom: 4 }}>
              {'• '}
              {stripMd(line.slice(2))}
            </Text>
          );
        }
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <Text
              key={i}
              variant="bodySm"
              weight="semibold"
              style={{ marginTop: 8, marginBottom: 4 }}
            >
              {line.replace(/\*\*/g, '')}
            </Text>
          );
        }
        return (
          <Text key={i} variant="bodySm" tone="secondary" style={{ marginBottom: 4 }}>
            {stripMd(line)}
          </Text>
        );
      })}
    </View>
  );
}
