// Cobre a costura entre a URL que a API monta (Stripe success_url, link do
// e-mail de confirmação — packages/shared/src/presale.ts) e a leitura da
// querystring nesta página (obrigado/page.tsx). A API manda `t`; a página lia
// `token` até este conserto, então 100% dos compradores caíam no estado de
// "faltam parâmetros" mesmo com um pedido pago de verdade. A URL aqui é
// montada pelo MESMO builder que a API usa — nunca redigite a querystring à
// mão, isso reabriria o mesmo buraco de uma grafia nova.
import { presaleOrderStatusUrl } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const searchParamsState = { current: new URLSearchParams() };

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsState.current,
}));

import ObrigadoPage from '../obrigado/page';

import { presaleCopy } from '~/copy/presale';

describe('obrigado/page.tsx — nomes de parâmetro da querystring', () => {
  it('encontra orderId e token quando a URL vem do builder da API', () => {
    const url = presaleOrderStatusUrl('https://garage.casacar.club', 'order_123', 'tok_abc');
    const query = url.split('?')[1]!;
    searchParamsState.current = new URLSearchParams(query);

    const html = renderToStaticMarkup(<ObrigadoPage />);

    expect(html).not.toContain(presaleCopy.orderStatus.missingParams.title);
    expect(html).toContain(presaleCopy.orderStatus.loading.title);
  });

  it('cai no estado de parâmetros faltando quando a URL usa a grafia antiga `token`', () => {
    // Grafia do bug original: a API nunca manda `token`, só `t`. Esta URL
    // representa o que a página ANTES do conserto esperava — e continua
    // sendo o estado correto para uma querystring que não é a da API.
    searchParamsState.current = new URLSearchParams({ orderId: 'order_123', token: 'tok_abc' });

    const html = renderToStaticMarkup(<ObrigadoPage />);

    expect(html).toContain(presaleCopy.orderStatus.missingParams.title);
  });
});
