import { TERMS_VERSION, termsSections } from '@ccc/shared/terms';
import type { Metadata } from 'next';

import { brand } from '~/brand';
import { PolicyBody } from '~/components/policy-body';

export const metadata: Metadata = {
  title: `Termos de uso · ${brand.name}`,
  description: `Termos de uso da ${brand.name}: assinatura, ingressos, loja, cancelamento e reembolso.`,
};

/**
 * Public terms page.
 *
 * The mobile app renders the same content from a bundled screen, which satisfies
 * the in-app EULA. This page exists because a hosted URL is a separate artifact:
 * App Store Connect consumes a link, and an auto-renewing subscription needs a
 * reachable Terms of Use. Until this existed, casacar.club/termos was a 404 while
 * casacar.club/privacidade was live.
 */
export default function TermosPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="mb-1 text-sm text-[color:var(--color-muted)]">{brand.name}</p>
        <h1 className="text-3xl font-bold">Termos de uso</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          Versão:{' '}
          <code className="rounded bg-[color:var(--color-surface)] px-1 py-0.5 font-mono text-xs">
            {TERMS_VERSION}
          </code>
        </p>
      </header>

      <nav className="mb-10 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
        <p className="mb-2 text-sm font-semibold">Índice</p>
        <ol className="list-decimal pl-4 text-sm text-[color:var(--color-muted)] space-y-1">
          {termsSections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline hover:text-[color:var(--color-foreground)]">
                {s.title.replace(/^\d+\.\s/, '')}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="prose prose-invert max-w-none space-y-10">
        {termsSections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-6">
            <h2 className="mb-3 text-xl font-semibold">{section.title}</h2>
            <PolicyBody text={section.body} />
          </section>
        ))}
      </article>

      <footer className="mt-12 border-t border-[color:var(--color-border)] pt-6 text-xs text-[color:var(--color-muted)]">
        <p>
          Dúvidas, cancelamento ou reembolso:{' '}
          <a
            href={`mailto:${brand.contact.contactEmail}`}
            className="underline hover:text-[color:var(--color-foreground)]"
          >
            {brand.contact.contactEmail}
          </a>
        </p>
      </footer>
    </div>
  );
}
