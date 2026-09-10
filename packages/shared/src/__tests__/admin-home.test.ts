import { describe, expect, it } from 'vitest';

import { HERO_TITLE_MAX, homeContentUpdateSchema } from '../admin-home.js';

const base = { expectedUpdatedAt: '2026-01-01T00:00:00.000Z' };

describe('homeContentUpdateSchema', () => {
  it('coage string vazia para null nos campos opcionais', () => {
    const parsed = homeContentUpdateSchema.parse({
      ...base,
      heroSubtitle: '',
      heroBannerObjectKey: '',
      institutionalImageObjectKey: '   ',
    });
    expect(parsed.heroSubtitle).toBeNull();
    expect(parsed.heroBannerObjectKey).toBeNull();
    expect(parsed.institutionalImageObjectKey).toBeNull();
  });

  it('aceita null explicito', () => {
    const parsed = homeContentUpdateSchema.parse({ ...base, heroSubtitle: null });
    expect(parsed.heroSubtitle).toBeNull();
  });

  it('trima os campos obrigatorios e recusa branco', () => {
    const parsed = homeContentUpdateSchema.parse({ ...base, heroTitle: '  MOTE  ' });
    expect(parsed.heroTitle).toBe('MOTE');
    expect(() => homeContentUpdateSchema.parse({ ...base, heroTitle: '   ' })).toThrow();
  });

  it('limita heroTitle ao que cabe no hero, nao ao tamanho da coluna', () => {
    expect(HERO_TITLE_MAX).toBe(70);
    expect(() => homeContentUpdateSchema.parse({ ...base, heroTitle: 'a'.repeat(71) })).toThrow();
    expect(() =>
      homeContentUpdateSchema.parse({ ...base, institutionalBody: 'a'.repeat(1001) }),
    ).toThrow();
  });

  it('exige expectedUpdatedAt', () => {
    expect(() => homeContentUpdateSchema.parse({ heroTitle: 'X' })).toThrow();
  });

  it('deixa campos ausentes como undefined', () => {
    const parsed = homeContentUpdateSchema.parse(base);
    expect(parsed.heroTitle).toBeUndefined();
    expect(parsed.heroSubtitle).toBeUndefined();
  });
});
