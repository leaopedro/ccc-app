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
});
