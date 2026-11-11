import { PRIVACY_POLICY_VERSION, privacyPolicySections } from '@ccc/shared/legal';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PrivacidadePage from '../page';

// environment: 'node' (vitest.config.ts) — renderToStaticMarkup only, no DOM,
// no jsdom, per the garage suite's own constraint.
describe('PrivacidadePage', () => {
  it('renderiza o título, a versão e todas as seções da política', () => {
    const html = renderToStaticMarkup(<PrivacidadePage />);

    expect(html).toContain('Política de privacidade');
    expect(html).toContain(PRIVACY_POLICY_VERSION);
    for (const section of privacyPolicySections) {
      expect(html).toContain(section.title);
    }
    expect(html).not.toContain('undefined');
  });

  it('inclui a nova seção de compra sem conta (convidado da pré-venda)', () => {
    const html = renderToStaticMarkup(<PrivacidadePage />);

    expect(html).toContain('convidado da pré-venda Casa In Box');
  });
});
