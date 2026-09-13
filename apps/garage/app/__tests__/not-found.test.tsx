import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Via o shim `~/brand`, nao `@ccc/design/brand`: o subpath exportado resolve
// para dist/, e o CI so builda @ccc/db e @ccc/shared. O shim le a fonte por
// caminho relativo e nao depende de build nenhum.
import RootNotFound from '../not-found';

import { brand } from '~/brand';

describe('RootNotFound', () => {
  it('produces byte-identical markup across renders', () => {
    const a = renderToStaticMarkup(<RootNotFound />);
    const b = renderToStaticMarkup(<RootNotFound />);
    expect(a).toBe(b);
  });

  it('renders the HTTP 404 stamp + Portuguese heading', () => {
    const html = renderToStaticMarkup(<RootNotFound />);
    expect(html).toContain('Página não encontrada');
    expect(html).toContain('HTTP 404');
  });

  it('offers a way out to the main site', () => {
    const html = renderToStaticMarkup(<RootNotFound />);
    expect(html).toContain(`href="${brand.urls.appBase}"`);
  });

  // The root 404 must not leak the garage-specific copy: this page is reached
  // by anything that is not /g/:slug, and saying "garagem não encontrada" for
  // a typo'd path would be wrong.
  it('does not reuse the garage-specific copy', () => {
    const html = renderToStaticMarkup(<RootNotFound />);
    expect(html).not.toContain('Garagem não encontrada');
  });
});
