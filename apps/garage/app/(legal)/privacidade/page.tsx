import { PRIVACY_POLICY_VERSION, privacyPolicySections } from '@ccc/shared/legal';
import type { Metadata } from 'next';

import { PolicyBody } from '~/components/legal/PolicyBody';

export const metadata: Metadata = {
  title: 'Política de privacidade — Casa Car Club',
};

// Outside the (garage) route group on purpose: that group's layout pins a
// 430px phone-width column (app/(garage)/layout.tsx), which reads fine for a
// garage profile ported from the app but turns legal text into a sliver on a
// desktop viewport. This page gets the root layout's full width instead.
//
// The Casa In Box pre-sale checkout collects `acceptedPrivacyVersion`
// (services/presale/checkout.ts) against this exact PRIVACY_POLICY_VERSION;
// this is the page a consent checkbox on garage.casacar.club should link to
// so the titular can actually read what they are accepting.
export default function PrivacidadePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-1">
        <p className="font-mono text-xs tracking-wide text-muted uppercase">Casa Car Club</p>
        <h1 className="text-2xl font-semibold text-fg">Política de privacidade</h1>
        <p className="mt-1 text-xs text-muted">Versão: {PRIVACY_POLICY_VERSION}</p>
      </header>

      <div className="flex flex-col gap-10">
        {privacyPolicySections.map((section) => (
          <section key={section.id}>
            <h2 className="mb-3 text-base font-semibold text-fg">{section.title}</h2>
            <PolicyBody text={section.body} />
          </section>
        ))}
      </div>
    </div>
  );
}
