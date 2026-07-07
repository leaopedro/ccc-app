// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {
  grantConsent,
  withdrawConsent,
  hasSeenMarketingConsentPrompt,
  markMarketingConsentPromptSeen,
} = vi.hoisted(() => ({
  grantConsent: vi.fn(),
  withdrawConsent: vi.fn(),
  hasSeenMarketingConsentPrompt: vi.fn(),
  markMarketingConsentPromptSeen: vi.fn(),
}));

vi.mock('~/api/consents', () => ({
  grantConsent,
  withdrawConsent,
  listConsents: vi.fn(),
}));

vi.mock('../storage', () => ({
  hasSeenMarketingConsentPrompt,
  markMarketingConsentPromptSeen,
}));

import type { MarketingConsentGate } from '../useMarketingConsentGate';
import { useMarketingConsentGate } from '../useMarketingConsentGate';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let snapshot: MarketingConsentGate | null = null;

function Probe({ authenticated }: { authenticated: boolean }) {
  snapshot = useMarketingConsentGate(authenticated);
  return null;
}

describe('useMarketingConsentGate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    snapshot = null;
    grantConsent.mockReset();
    withdrawConsent.mockReset();
    hasSeenMarketingConsentPrompt.mockReset();
    markMarketingConsentPromptSeen.mockReset();
    grantConsent.mockResolvedValue({
      id: '1',
      purpose: 'push_marketing',
      version: '1.0',
      givenAt: new Date().toISOString(),
      withdrawnAt: null,
      channel: 'mobile',
    });
    withdrawConsent.mockResolvedValue(undefined);
    markMarketingConsentPromptSeen.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('visible=true when authenticated and prompt not yet seen', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    expect(snapshot!.visible).toBe(true);
  });

  it('visible=false when not authenticated (skips storage check)', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);

    await act(async () => {
      root.render(<Probe authenticated={false} />);
      await flush();
    });

    expect(snapshot!.visible).toBe(false);
    expect(hasSeenMarketingConsentPrompt).not.toHaveBeenCalled();
  });

  it('visible=false when prompt already seen', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(true);

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    expect(snapshot!.visible).toBe(false);
  });

  it('handleAccept: calls grantConsent + markSeen, resets visible and submitting', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    expect(snapshot!.visible).toBe(true);

    await act(async () => {
      await snapshot!.handleAccept();
    });

    expect(grantConsent).toHaveBeenCalledWith({
      purpose: 'push_marketing',
      version: '1.0',
      evidence: { source: 'mobile_reconsent_modal' },
    });
    expect(markMarketingConsentPromptSeen).toHaveBeenCalled();
    expect(snapshot!.visible).toBe(false);
    expect(snapshot!.submitting).toBe(false);
  });

  it('handleDecline: calls withdrawConsent + markSeen, resets visible and submitting', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    await act(async () => {
      await snapshot!.handleDecline();
    });

    expect(withdrawConsent).toHaveBeenCalledWith('push_marketing');
    expect(markMarketingConsentPromptSeen).toHaveBeenCalled();
    expect(snapshot!.visible).toBe(false);
    expect(snapshot!.submitting).toBe(false);
  });

  it('handleDecline: does NOT markSeen when withdrawConsent throws, keeps modal visible', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);
    withdrawConsent.mockRejectedValue(new Error('network'));

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    await act(async () => {
      await snapshot!.handleDecline().catch(() => {});
    });

    expect(markMarketingConsentPromptSeen).not.toHaveBeenCalled();
    expect(snapshot!.visible).toBe(true);
    expect(snapshot!.submitting).toBe(false);
  });

  it('handleAccept: does NOT markSeen when grantConsent throws, keeps modal visible', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);
    grantConsent.mockRejectedValue(new Error('network'));

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    await act(async () => {
      await snapshot!.handleAccept().catch(() => {});
    });

    expect(markMarketingConsentPromptSeen).not.toHaveBeenCalled();
    expect(snapshot!.visible).toBe(true);
    expect(snapshot!.submitting).toBe(false);
  });

  it('auth loss resets visible to false', async () => {
    hasSeenMarketingConsentPrompt.mockResolvedValue(false);

    await act(async () => {
      root.render(<Probe authenticated={true} />);
      await flush();
    });

    expect(snapshot!.visible).toBe(true);

    await act(async () => {
      root.render(<Probe authenticated={false} />);
      await flush();
    });

    expect(snapshot!.visible).toBe(false);
  });
});
