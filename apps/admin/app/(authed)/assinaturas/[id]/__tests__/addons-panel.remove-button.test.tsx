// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('~/lib/assinaturas-actions', () => ({
  attachAddonAction: vi.fn(),
  detachAddonAction: vi.fn(),
}));

const { AddonsPanel } = await import('../addons-panel');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * Fix round 2, finding 2: the remove button used to be offered for every
 * key in `attachedKeys` (everything except `cancelled`), including
 * `cancel_scheduled` add-ons whose providerItemRef Stripe already deleted.
 * A second click re-issues removeSubscriptionItem for a gone item — inside
 * Stripe's 24h idempotency window it looks like success, after it the row
 * is stuck on a button that can only 500. `attachAddon` also refuses to
 * re-attach anything but `cancelled`, so the row offers no working action.
 *
 * Fix: remove buttons render from `removableKeys` (status === 'active'
 * only, computed by the page from the addon list), while `attachedKeys`
 * (everything but cancelled) keeps excluding options from the attach
 * select. `removableKeys` defaults to `attachedKeys` when omitted, so the
 * pre-existing interaction test that only passes `attachedKeys` keeps
 * behaving as before.
 */
describe('AddonsPanel — botao de remover modulo', () => {
  it('nao oferece remover para modulo cancel_scheduled, so para os ativos', async () => {
    await act(async () => {
      root.render(
        <AddonsPanel
          membershipId="mem-1"
          mutable={true}
          status="active"
          attachedKeys={['detailing', 'valet']}
          removableKeys={['detailing']}
          moduleOptions={[]}
        />,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="assinaturas-acao-remover-modulo-detailing"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="assinaturas-acao-remover-modulo-valet"]'),
    ).toBeNull();
  });

  it('sem removableKeys, cai no comportamento antigo usando attachedKeys (retrocompatibilidade)', async () => {
    await act(async () => {
      root.render(
        <AddonsPanel
          membershipId="mem-1"
          mutable={true}
          status="active"
          attachedKeys={['detailing']}
          moduleOptions={[]}
        />,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="assinaturas-acao-remover-modulo-detailing"]'),
    ).not.toBeNull();
  });

  it('attachedKeys ainda exclui as opcoes do select mesmo quando removableKeys e menor', async () => {
    await act(async () => {
      root.render(
        <AddonsPanel
          membershipId="mem-1"
          mutable={true}
          status="active"
          attachedKeys={['detailing', 'valet']}
          removableKeys={['detailing']}
          moduleOptions={[
            { key: 'detailing', name: 'Detailing' },
            { key: 'valet', name: 'Valet' },
            { key: 'track-days', name: 'Track Days' },
          ]}
        />,
      );
      await Promise.resolve();
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-modulo-select"]',
    );
    const optionValues = Array.from(select?.querySelectorAll('option') ?? []).map((o) => o.value);
    expect(optionValues).toEqual(['track-days']);
  });
});
