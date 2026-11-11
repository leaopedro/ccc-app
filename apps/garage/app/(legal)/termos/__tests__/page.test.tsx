import { TERMS_VERSION, termsSections } from '@ccc/shared/terms';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TermosPage from '../page';

// environment: 'node' (vitest.config.ts) — renderToStaticMarkup only, no DOM,
// no jsdom, per the garage suite's own constraint.
describe('TermosPage', () => {
  it('renderiza o título, a versão e todas as seções dos termos', () => {
    const html = renderToStaticMarkup(<TermosPage />);

    expect(html).toContain('Termos de uso');
    expect(html).toContain(TERMS_VERSION);
    for (const section of termsSections) {
      expect(html).toContain(section.title);
    }
    expect(html).not.toContain('undefined');
  });
});
