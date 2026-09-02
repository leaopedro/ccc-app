import { describe, expect, it } from 'vitest';

import { premiumSheetBenefits } from '~/screens/garage/premium-benefits';

import { garageCopy, garageCopyEn } from '../garage';

const titlesOf = (list: ReadonlyArray<{ title: string }>) => list.map((b) => b.title);

// Two purely digital benefits is the shape that makes the membership read as a
// digital bundle, which is the 3.1.1 argument the spec says Decision 6 only
// weakens rather than removes. The physical box has to be in the list a member
// reads while deciding — but only in a build that can actually ship one
// (fix round 2, C2).
describe('premium explainer sheet', () => {
  it('mentions the physical box in PT when the caixa build flag is on', () => {
    const titles = titlesOf(
      premiumSheetBenefits({ caixaEnabled: true, copy: garageCopy.garage }),
    ).join(' | ');
    expect(titles.toLowerCase()).toContain('caixa');
  });

  it('mentions the physical box in EN when the caixa build flag is on', () => {
    const titles = titlesOf(
      premiumSheetBenefits({ caixaEnabled: true, copy: garageCopyEn.garage }),
    ).join(' | ');
    expect(titles.toLowerCase()).toContain('box');
  });

  // Both lists must stay the same length: a reviewer reading EN must see the
  // same promises as one reading PT.
  it('keeps PT and EN in lockstep', () => {
    expect(garageCopyEn.garage.premiumBenefits).toHaveLength(
      garageCopy.garage.premiumBenefits.length,
    );
  });

  // Fix round 1: the exact titles, not just a substring, so a future edit
  // can't silently reintroduce "Acesso ao clube" (no entitlement gate exists
  // anywhere in the code).
  //
  // Fix round 2 (I3): "Eventos abertos da comunidade" is gone too. Its only
  // evidence was the same kind of seed marketing label (seed.ts:526) that was
  // rejected for club access; schema.prisma's `Event` has no membership field
  // and the codebase's only `minTier` gates box catalog items, not events.
  it('lists exactly the audited PT benefit titles with the caixa build on', () => {
    const titles = titlesOf(premiumSheetBenefits({ caixaEnabled: true, copy: garageCopy.garage }));
    expect(titles).toEqual(['Caixa física da Casa', 'Capas personalizadas', 'Selo Premium']);
  });

  it('lists exactly the audited EN benefit titles with the caixa build on', () => {
    const titles = titlesOf(
      premiumSheetBenefits({ caixaEnabled: true, copy: garageCopyEn.garage }),
    );
    expect(titles).toEqual(['The Casa box', 'Custom covers', 'Premium badge']);
  });

  // Final review C2 — the regression this pins. EXPO_PUBLIC_CAIXA_ENABLED is
  // absent from BOTH eas profiles, so this is what a shipped binary renders:
  // the box must not be advertised, because the member can never opt in, add
  // items or set an address, and box-cutoff.ts skips exactly those boxes.
  it('drops the caixa from both languages when the caixa build flag is off', () => {
    expect(
      titlesOf(premiumSheetBenefits({ caixaEnabled: false, copy: garageCopy.garage })),
    ).toEqual(['Capas personalizadas', 'Selo Premium']);
    expect(
      titlesOf(premiumSheetBenefits({ caixaEnabled: false, copy: garageCopyEn.garage })),
    ).toEqual(['Custom covers', 'Premium badge']);
  });

  // The raw copy list is what a careless call site would render directly, so
  // pin that it holds nothing conditional on its own.
  it('keeps the ungated copy list free of the caixa', () => {
    expect(titlesOf(garageCopy.garage.premiumBenefits).join(' | ').toLowerCase()).not.toContain(
      'caixa',
    );
    expect(titlesOf(garageCopyEn.garage.premiumBenefits).join(' | ').toLowerCase()).not.toContain(
      'box',
    );
  });

  // Fix round 1: the box's charge is overflow + addons + shipping
  // (box/charge.ts), not something folded into the subscription price, so
  // the sub-copy must not claim it's included.
  it('does not claim the box is included in the subscription price', () => {
    expect(garageCopy.garage.premiumBenefitCaixa.sub.toLowerCase()).not.toContain(
      'incluída na assinatura',
    );
  });

  // Fix round 1: there is no entitlement gate for club access anywhere in
  // the code (fridge-unlock.ts authenticates on a shared API key, not a
  // member/tier; check-in is ticket-scoped). Don't promise it.
  //
  // Fix round 2 (I3): same rule for events, which have no entitlement gate
  // either. Checked against the caixa-on list so neither branch can smuggle
  // one back in.
  it('promises neither club access nor event attendance', () => {
    const titles = titlesOf(premiumSheetBenefits({ caixaEnabled: true, copy: garageCopy.garage }))
      .join(' | ')
      .toLowerCase();
    expect(titles).not.toContain('clube');
    expect(titles).not.toContain('evento');
  });
});
