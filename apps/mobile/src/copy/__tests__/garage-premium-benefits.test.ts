import { describe, expect, it } from 'vitest';

import { garageCopy, garageCopyEn } from '../garage';

// Two purely digital benefits is the shape that makes the membership read as a
// digital bundle, which is the 3.1.1 argument the spec says Decision 6 only
// weakens rather than removes. The physical box has to be in the list a member
// reads while deciding.
describe('premium explainer sheet', () => {
  it('mentions the physical box in PT', () => {
    const titles = garageCopy.garage.premiumBenefits.map((b) => b.title).join(' | ');
    expect(titles.toLowerCase()).toContain('caixa');
  });

  it('mentions the physical box in EN', () => {
    const titles = garageCopyEn.garage.premiumBenefits.map((b) => b.title).join(' | ');
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
  // anywhere in the code) or drop the community-events benefit that replaced
  // it.
  it('lists exactly the audited PT benefit titles', () => {
    const titles = garageCopy.garage.premiumBenefits.map((b) => b.title);
    expect(titles).toEqual([
      'Caixa física da Casa',
      'Eventos abertos da comunidade',
      'Capas personalizadas',
      'Selo Premium',
    ]);
  });

  it('lists exactly the audited EN benefit titles', () => {
    const titles = garageCopyEn.garage.premiumBenefits.map((b) => b.title);
    expect(titles).toEqual([
      'The Casa box',
      'Open community events',
      'Custom covers',
      'Premium badge',
    ]);
  });

  // Fix round 1: the box's charge is overflow + addons + shipping
  // (box/charge.ts), not something folded into the subscription price, so
  // the sub-copy must not claim it's included.
  it('does not claim the box is included in the subscription price', () => {
    const sub = garageCopy.garage.premiumBenefits[0]?.sub ?? '';
    expect(sub.toLowerCase()).not.toContain('incluída na assinatura');
  });

  // Fix round 1: there is no entitlement gate for club access anywhere in
  // the code (fridge-unlock.ts authenticates on a shared API key, not a
  // member/tier; check-in is ticket-scoped). Don't promise it.
  it('does not claim club access', () => {
    const titles = garageCopy.garage.premiumBenefits.map((b) => b.title).join(' | ');
    expect(titles.toLowerCase()).not.toContain('clube');
  });
});
