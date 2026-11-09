import { describe, expect, it } from 'vitest';

import { PRESALE_MAX_QTY_PER_VARIANT, presaleCheckoutRequestSchema } from '../presale.js';

const validDelivery = {
  recipientName: 'Maria Silva',
  line1: 'Rua das Flores',
  number: '123',
  district: 'Centro',
  city: 'Curitiba',
  stateCode: 'PR',
  postalCode: '80010-000',
};

const basePayload = {
  clientRequestId: 'req_12345',
  expectedTotalCents: 10_000,
  fulfillmentMethod: 'pickup' as const,
  items: [{ variantId: 'v1', quantity: 2 }],
  guest: {
    name: 'Maria Silva',
    email: 'maria@example.com',
    phone: '41999998888',
  },
  acceptedTermsVersion: 'terms-2026-08-14',
  acceptedPrivacyVersion: 'privacy-2026-08-29',
};

const req = (patch: Record<string, unknown>) => ({ ...basePayload, ...patch });

describe('presaleCheckoutRequestSchema', () => {
  it('aceita um payload de retirada válido', () => {
    expect(presaleCheckoutRequestSchema.safeParse(req({})).success).toBe(true);
  });

  it('aceita um payload de entrega válido', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({ fulfillmentMethod: 'ship', delivery: validDelivery }),
      ).success,
    ).toBe(true);
  });

  it('recusa quantidade fora de 1..20', () => {
    for (const quantity of [0, -1, 1.5, 21, '2' as unknown as number]) {
      expect(
        presaleCheckoutRequestSchema.safeParse(req({ items: [{ variantId: 'v1', quantity }] }))
          .success,
      ).toBe(false);
    }
  });

  it('aceita o teto de 20 unidades', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({ items: [{ variantId: 'v1', quantity: PRESALE_MAX_QTY_PER_VARIANT }] }),
      ).success,
    ).toBe(true);
  });

  it('recusa caixa vazia', () => {
    expect(presaleCheckoutRequestSchema.safeParse(req({ items: [] })).success).toBe(false);
  });

  it('recusa mais de 50 itens', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 }));
    expect(presaleCheckoutRequestSchema.safeParse(req({ items })).success).toBe(false);
  });

  it('exige delivery quando fulfillmentMethod é ship', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({ fulfillmentMethod: 'ship', delivery: undefined }),
      ).success,
    ).toBe(false);
  });

  it('recusa delivery quando fulfillmentMethod é pickup', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({ fulfillmentMethod: 'pickup', delivery: validDelivery }),
      ).success,
    ).toBe(false);
  });

  it('recusa email malformado', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({ guest: { name: 'Maria Silva', email: 'nao-e-email', phone: '41999998888' } }),
      ).success,
    ).toBe(false);
  });

  it('aceita guest sem telefone', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({ guest: { name: 'Maria Silva', email: 'maria@example.com' } }),
      ).success,
    ).toBe(true);
  });

  it('recusa CEP inválido na entrega', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(
        req({
          fulfillmentMethod: 'ship',
          delivery: { ...validDelivery, postalCode: 'abc' },
        }),
      ).success,
    ).toBe(false);
  });

  it('recusa clientRequestId vazio ou maior que 64 caracteres', () => {
    expect(presaleCheckoutRequestSchema.safeParse(req({ clientRequestId: '' })).success).toBe(
      false,
    );
    expect(
      presaleCheckoutRequestSchema.safeParse(req({ clientRequestId: 'a'.repeat(65) })).success,
    ).toBe(false);
  });

  it('recusa expectedTotalCents negativo ou fracionário', () => {
    expect(presaleCheckoutRequestSchema.safeParse(req({ expectedTotalCents: -1 })).success).toBe(
      false,
    );
    expect(presaleCheckoutRequestSchema.safeParse(req({ expectedTotalCents: 10.5 })).success).toBe(
      false,
    );
  });

  it('recusa fulfillmentMethod desconhecido', () => {
    expect(
      presaleCheckoutRequestSchema.safeParse(req({ fulfillmentMethod: 'courier' })).success,
    ).toBe(false);
  });
});
