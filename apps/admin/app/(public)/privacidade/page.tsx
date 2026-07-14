import { brand } from '~/brand';
import { privacyPolicySections, PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: `Política de privacidade · ${brand.name}`,
  description: `Política de privacidade e cookies da ${brand.name}, em conformidade com a LGPD (Lei nº 13.709/2018).`,
};

export default function PrivacidadePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="mb-1 text-sm text-[color:var(--color-muted)]">{brand.name}</p>
        <h1 className="text-3xl font-bold">Política de privacidade e cookies</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          Versão:{' '}
          <code className="rounded bg-[color:var(--color-surface)] px-1 py-0.5 font-mono text-xs">
            {PRIVACY_POLICY_VERSION}
          </code>{' '}
          · Vigência: 14 de maio de 2026
        </p>
      </header>

      <nav className="mb-10 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
        <p className="mb-2 text-sm font-semibold">Índice</p>
        <ol className="list-decimal pl-4 text-sm text-[color:var(--color-muted)] space-y-1">
          {privacyPolicySections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline hover:text-[color:var(--color-foreground)]">
                {s.title.replace(/^\d+\.\s/, '')}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="prose prose-invert max-w-none space-y-10">
        {privacyPolicySections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-6">
            <h2 className="mb-3 text-xl font-semibold">{section.title}</h2>
            <PolicyBody text={section.body} />
          </section>
        ))}
      </article>

      <footer className="mt-12 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-muted)]">
        <p>
          Dúvidas? Fale com nosso Encarregado:{' '}
          <a
            href={`mailto:${brand.contact.privacyEmail}`}
            className="underline hover:text-[color:var(--color-foreground)]"
          >
            {brand.contact.privacyEmail}
          </a>
        </p>
      </footer>
    </div>
  );
}

function PolicyBody({ text }: { text: string }) {
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
