import { HexBadge } from '@jdm/ui/web';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

type HexProps = React.ComponentProps<typeof HexBadge>;

// HexBadge web twin spec. Mirrors the visual contract of
// `packages/ui/src/HexBadge.tsx` (RN twin) — same hex polygon, same
// rarity ring palette via `garageTokens.rarity.*`, same sm/md/lg sizes,
// same earned / locked / locked_premium variants. SSR-safe (no
// `'use client'`).

describe('HexBadge (web)', () => {
  it('renders an earned legendary badge with the brand gold ring color', () => {
    const html = renderToStaticMarkup(
      <HexBadge code="JDM-003" variant="earned" rarity="legendary" icon="founder" size="md" />,
    );
    expect(html.toUpperCase()).toContain('#D4AF37');
  });

  it('renders an earned rare badge with the gold ring color', () => {
    const html = renderToStaticMarkup(
      <HexBadge code="EVT-002" variant="earned" rarity="rare" icon="streak" size="md" />,
    );
    expect(html.toUpperCase()).toContain('#E8B339');
  });

  it('renders an earned common badge with the silver-deep ring color', () => {
    const html = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    expect(html.toUpperCase()).toContain('#7C8088');
  });

  it('uses the canonical flat-top hex polygon (matches the mobile twin)', () => {
    const html = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    expect(html).toContain('25,5 75,5 100,50 75,95 25,95 0,50');
  });

  it('renders three sizes (sm=32, md=52, lg=96)', () => {
    const sm = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="sm" />,
    );
    const md = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    const lg = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="lg" />,
    );
    expect(sm).toContain('width="32"');
    expect(md).toContain('width="52"');
    expect(lg).toContain('width="96"');
  });

  it('renders the lock glyph for the locked variant', () => {
    const earned = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    const locked = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="locked" rarity="common" icon="flag" size="md" />,
    );
    // earned shows the Flag icon (lucide flag has the characteristic
    // M4 ... path). Locked replaces it with the Lock icon (rect at the
    // bottom + arc on top — `rect` element present).
    expect(locked).toContain('<rect');
    expect(earned).not.toEqual(locked);
  });

  it('renders the "Exclusivo Premium" tag for the locked_premium variant only', () => {
    const lockedPremium = renderToStaticMarkup(
      <HexBadge
        code="JDM-003"
        variant="locked_premium"
        rarity="legendary"
        icon="founder"
        size="md"
      />,
    );
    const locked = renderToStaticMarkup(
      <HexBadge code="JDM-003" variant="locked" rarity="legendary" icon="founder" size="md" />,
    );
    expect(lockedPremium).toContain('Exclusivo Premium');
    expect(locked).not.toContain('Exclusivo Premium');
  });

  it('exposes an accessibility label that names the badge code + state', () => {
    const html = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    expect(html).toContain('Conquista EVT-001, desbloqueada');
    const lockedHtml = renderToStaticMarkup(
      <HexBadge code="EVT-001" variant="locked" rarity="common" icon="flag" size="md" />,
    );
    expect(lockedHtml).toContain('Conquista EVT-001, bloqueada');
  });

  it('falls back to the generic placeholder glyph for an unknown icon string', () => {
    // Unknown icon name resolves to HelpCircle. Should not throw.
    const html = renderToStaticMarkup(
      <HexBadge
        code="EVT-001"
        variant="earned"
        rarity="common"
        icon="unknown-icon-foo"
        size="md"
      />,
    );
    expect(html).toContain('Conquista EVT-001');
  });

  it('renders the optional label under the hex when provided', () => {
    const html = renderToStaticMarkup(
      <HexBadge
        code="EVT-001"
        variant="earned"
        rarity="common"
        icon="flag"
        size="md"
        label="Primeiro Evento"
      />,
    );
    expect(html).toContain('Primeiro Evento');
  });

  const renderHex = (p: Pick<HexProps, 'variant' | 'rarity' | 'size'>) =>
    renderToStaticMarkup(<HexBadge code="X" icon="flag" {...p} />);

  it('earned legendary md renders the corner-dot', () => {
    expect(renderHex({ variant: 'earned', rarity: 'legendary', size: 'md' })).toContain(
      'data-testid="hex-legendary-dot"',
    );
  });
  it('earned common md does NOT render the corner-dot', () => {
    expect(renderHex({ variant: 'earned', rarity: 'common', size: 'md' })).not.toContain(
      'hex-legendary-dot',
    );
  });
  it('earned legendary sm suppresses the corner-dot', () => {
    expect(renderHex({ variant: 'earned', rarity: 'legendary', size: 'sm' })).not.toContain(
      'hex-legendary-dot',
    );
  });
});
