import { TERMS_VERSION, termsSections } from '@ccc/shared/terms';
import type { Metadata } from 'next';

import { PolicyBody } from '~/components/legal/PolicyBody';

export const metadata: Metadata = {
  title: 'Termos de uso — Casa Car Club',
};

// Outside the (garage) route group — same reasoning as
// app/(legal)/privacidade/page.tsx: legal text needs the root layout's full
// width, not the 430px phone column the garage profile uses.
export default function TermosPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-1">
        <p className="font-mono text-xs tracking-wide text-muted uppercase">Casa Car Club</p>
        <h1 className="text-2xl font-semibold text-fg">Termos de uso</h1>
        <p className="mt-1 text-xs text-muted">Versão: {TERMS_VERSION}</p>
      </header>

      <div className="flex flex-col gap-10">
        {termsSections.map((section) => (
          <section key={section.id}>
            <h2 className="mb-3 text-base font-semibold text-fg">{section.title}</h2>
            <PolicyBody text={section.body} />
          </section>
        ))}
      </div>
    </div>
  );
}
