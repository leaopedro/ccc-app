import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock('~/lib/broadcast-actions', () => ({
  createBroadcastAction: vi.fn(),
  dryRunBroadcastAction: vi.fn(),
}));

import { BroadcastComposer } from './broadcast-composer';

describe('BroadcastComposer', () => {
  it('renders delivery mode and destination controls for inbox routing', () => {
    const html = renderToStaticMarkup(
      <BroadcastComposer
        events={[{ id: 'evt_1', title: 'Track Day', startsAt: '2026-06-01T12:00:00.000Z' }]}
        products={[{ id: 'prod_1', title: 'Moletom', slug: 'moletom', status: 'active' }]}
      />,
    );

    expect(html).toContain('Somente na central');
    expect(html).toContain('Central + push');
    expect(html).toContain('Push também grava o item na central');
    expect(html).toContain('Evento do app');
    expect(html).toContain('Produto da loja');
    expect(html).toContain('Caminho interno avançado');
    expect(html).toContain('URL externa avançada');
  });
});
