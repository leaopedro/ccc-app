import { brand } from '@jdm/design';
import { privacyPolicySections, PRIVACY_POLICY_VERSION } from '@jdm/shared/legal';
import { Text } from '@jdm/ui';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, SafeAreaView, ScrollView, View } from 'react-native';

export default function PrivacidadeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={8}
          style={{
            height: 44,
            width: 44,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: -8,
          }}
        >
          <ArrowLeft color="#F5F5F5" size={24} strokeWidth={1.75} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="bodySm" tone="muted">
            {brand.name}
          </Text>
          <Text variant="h3" weight="bold">
            Política de privacidade
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted" style={{ marginBottom: 24 }}>
          Versão: {PRIVACY_POLICY_VERSION} · Vigência: 14 de maio de 2026
        </Text>

        {privacyPolicySections.map((section) => (
          <View key={section.id} style={{ marginBottom: 28 }}>
            <Text variant="body" weight="semibold" style={{ marginBottom: 8 }}>
              {section.title}
            </Text>
            <PolicyBody text={section.body} />
          </View>
        ))}

        <View
          style={{ borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingTop: 16, marginTop: 8 }}
        >
          <Text variant="caption" tone="muted">
            Dúvidas? Fale com nosso Encarregado:{'\n'}{brand.contact.privacyEmail}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

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

function PolicyBody({ text }: { text: string }) {
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
