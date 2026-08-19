import { color } from '@ccc/design';
// tailwind-preset.cjs is a CJS module (Tailwind config can't import ESM/TS at
// build time); the ESM default import interops with it under Vite/vitest.
import tailwindPreset from '@ccc/design/tailwind-preset';
import { describe, expect, it } from 'vitest';

// packages/design/src/tokens.ts and packages/design/tailwind-preset.cjs both
// hard-code the same five gold-palette values added for the tela de Início
// (see comments in both files: "keep tailwind-preset.cjs in sync" /
// "espelha src/tokens.ts"). Nothing but that comment enforced it until now —
// this test is what actually enforces it. Placed in apps/mobile because
// packages/design has no test script or vitest dependency configured.
describe('design tokens <-> tailwind preset sync (gold palette)', () => {
  const colors = (
    tailwindPreset as { theme: { extend: { colors: Record<string, unknown> } } }
  ).theme.extend.colors;
  const gold = colors.gold as { deep: string; light: string };
  const hairline = colors.hairline as { gold: string; 'gold-strong': string };

  it('goldDeep matches gold.deep', () => {
    expect(gold.deep).toBe(color.goldDeep);
  });

  it('goldLight matches gold.light', () => {
    expect(gold.light).toBe(color.goldLight);
  });

  it('surfaceGold matches surface-gold', () => {
    expect(colors['surface-gold']).toBe(color.surfaceGold);
  });

  it('hairlineGold matches hairline.gold', () => {
    expect(hairline.gold).toBe(color.hairlineGold);
  });

  it('hairlineGoldStrong matches hairline.gold-strong', () => {
    expect(hairline['gold-strong']).toBe(color.hairlineGoldStrong);
  });
});
