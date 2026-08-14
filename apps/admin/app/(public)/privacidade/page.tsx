import { privacyPolicySections, PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type { Metadata } from 'next';

import { brand } from '~/brand';
import { PolicyBody } from '~/components/policy-body';

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
          </code>
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
