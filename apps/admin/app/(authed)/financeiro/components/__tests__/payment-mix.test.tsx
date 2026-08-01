import type { AdminFinancePaymentMixItem } from '@ccc/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PaymentMix } from '../payment-mix';

const stripeCard: AdminFinancePaymentMixItem = {
  provider: 'stripe',
  method: 'card',
  revenueCents: 300000,
  orderCount: 6,
  percentage: 50.0,
};
const abacatePix: AdminFinancePaymentMixItem = {
  provider: 'abacatepay',
  method: 'pix',
  revenueCents: 180000,
  orderCount: 4,
  percentage: 30.0,
};
const stripeSub: AdminFinancePaymentMixItem = {
  provider: 'stripe',
  method: 'subscription',
  revenueCents: 90000,
  orderCount: 0,
  percentage: 15.0,
};
const appleStoreKit: AdminFinancePaymentMixItem = {
  provider: 'apple_revenuecat',
  method: 'storekit',
  revenueCents: 30000,
  orderCount: 0,
  percentage: 5.0,
};

describe('PaymentMix — F8 rows (chunk 15)', () => {
  it('renders "Assinatura · Stripe" for stripe:subscription', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeSub]} />);
    expect(html).toContain('Assinatura · Stripe');
  });

  it('renders "App Store · RevenueCat" for apple_revenuecat:storekit', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[appleStoreKit]} />);
    expect(html).toContain('App Store · RevenueCat');
  });

  it('renders up to 4 rows when all four item types present', () => {
    const html = renderToStaticMarkup(
      <PaymentMix items={[stripeCard, abacatePix, stripeSub, appleStoreKit]} />,
    );
    expect(html).toContain('Cartão · Stripe');
    expect(html).toContain('Pix · AbacatePay');
    expect(html).toContain('Assinatura · Stripe');
    expect(html).toContain('App Store · RevenueCat');
  });

  it('renders existing stripe:card row unchanged', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeCard]} />);
    expect(html).toContain('Cartão · Stripe');
  });

  it('renders existing abacatepay:pix row unchanged', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[abacatePix]} />);
    expect(html).toContain('Pix · AbacatePay');
  });

  it('renders empty state when items is empty', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[]} />);
    expect(html).toContain('Sem dados.');
  });

  it('stripe:subscription row shows percentage bar markup', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeSub]} />);
    // Progress bar has inline width style
    expect(html).toContain('width:15%');
  });

  // F8.15 fix-up: subscription/storekit rows are invoices, not orders. Use
  // "cobranças" (charges) instead of "pedidos" so the count label is
  // semantically correct for membership lines.
  it('renders "cobranças" label for stripe:subscription row', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeSub]} />);
    expect(html).toContain('cobranças');
    expect(html).not.toContain('pedidos');
  });

  it('renders "cobranças" label for apple_revenuecat:storekit row', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[appleStoreKit]} />);
    expect(html).toContain('cobranças');
    expect(html).not.toContain('pedidos');
  });

  it('keeps "pedidos" label for stripe:card row', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeCard]} />);
    expect(html).toContain('pedidos');
    expect(html).not.toContain('cobranças');
  });

  it('keeps "pedidos" label for abacatepay:pix row', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[abacatePix]} />);
    expect(html).toContain('pedidos');
    expect(html).not.toContain('cobranças');
  });
});
