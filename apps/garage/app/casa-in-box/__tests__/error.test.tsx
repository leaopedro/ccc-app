import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import CasaInBoxError from '../error';

import { presaleCopy } from '~/copy/presale';

// Mensagem que `classifyTier` lançaria para um slug fora da allowlist
// (components/presale/selection.ts) — representa o conteúdo real que esta
// fronteira de erro precisa esconder do comprador.
const rawError = Object.assign(
  new Error(
    'slug de produto da pré-venda não reconhecido: "caixa-mistério". ' +
      'Slugs esperados: casa-in-box-basic, casa-in-box-premium.',
  ),
  { digest: 'abc123' },
);

describe('CasaInBoxError', () => {
  it('renderiza a copy PT-BR de pageError', () => {
    const html = renderToStaticMarkup(<CasaInBoxError error={rawError} reset={vi.fn()} />);
    expect(html).toContain(presaleCopy.pageError.title);
    expect(html).toContain(presaleCopy.pageError.body);
    expect(html).toContain(presaleCopy.pageError.retryCta);
  });

  it('nunca expõe a mensagem bruta do erro ao comprador', () => {
    const html = renderToStaticMarkup(<CasaInBoxError error={rawError} reset={vi.fn()} />);
    expect(html).not.toContain(rawError.message);
    expect(html).not.toContain('PRESALE_TIER_SLUGS');
    expect(html).not.toContain('caixa-mistério');
  });
});
