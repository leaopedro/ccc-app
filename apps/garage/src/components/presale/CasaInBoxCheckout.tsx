'use client';

import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type {
  PresaleCampaign,
  PresaleFulfillmentMethod,
  PresaleProduct,
} from '@ccc/shared/presale';
import { BRAZIL_STATE_CODES } from '@ccc/shared/profile';
import { TERMS_VERSION } from '@ccc/shared/terms';
import { useState } from 'react';

import { Faq } from './Faq';
import { TierCard } from './TierCard';
import {
  buildCheckoutPayload,
  computeExpectedTotalCents,
  isFulfillmentSupported,
  resolveCheckoutError,
  type CheckoutErrorCopy,
} from './selection';

import { presaleCopy } from '~/copy/presale';
import { fmtCurrencyCents } from '~/lib/format';
import { startPresaleCheckout } from '~/lib/presale-api';

type Props = {
  campaign: PresaleCampaign;
  products: PresaleProduct[];
};

type DeliveryState = {
  recipientName: string;
  line1: string;
  number: string;
  district: string;
  city: string;
  stateCode: string;
  postalCode: string;
};

const EMPTY_DELIVERY: DeliveryState = {
  recipientName: '',
  line1: '',
  number: '',
  district: '',
  city: '',
  stateCode: '',
  postalCode: '',
};

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'error'; copy: CheckoutErrorCopy };

/**
 * O componente cliente que carrega seleção e checkout (Task 14). Orquestra
 * as seções 3 a 7 da página: cards de tier, recebimento (com o checkbox de
 * consentimento do adendo), FAQ e o botão de pagar. Mantém a lógica de
 * seleção em funções puras (./selection.ts) — este arquivo só segura estado
 * e efeitos de borda (fetch, redirect).
 */
export function CasaInBoxCheckout({ campaign, products }: Props) {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    products[0]?.id ?? null,
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    products[0]?.variants[0]?.id ?? null,
  );
  const [fulfillmentMethod, setFulfillmentMethod] = useState<PresaleFulfillmentMethod>('pickup');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [delivery, setDelivery] = useState<DeliveryState>(EMPTY_DELIVERY);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: 'idle' });

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;
  const selectedVariant =
    selectedProduct?.variants.find((v) => v.id === selectedVariantId) ??
    selectedProduct?.variants[0] ??
    null;

  // Cálculo barato (uma soma condicional) — não vale a pena memoizar, e o
  // React Compiler recusa um useMemo manual aqui porque `selectedVariant`
  // vem de um `.find()` cuja referência ele não consegue provar estável.
  const expectedTotalCents = selectedVariant
    ? computeExpectedTotalCents(
        selectedVariant.priceCents,
        fulfillmentMethod,
        campaign.shippingFeeCents,
      )
    : 0;

  const handleSelectTier = (product: PresaleProduct) => {
    setSelectedProductId(product.id);
    setSelectedVariantId(product.variants[0]?.id ?? null);
  };

  const deliveryComplete =
    fulfillmentMethod === 'pickup' ||
    (delivery.recipientName.trim() !== '' &&
      delivery.line1.trim() !== '' &&
      delivery.number.trim() !== '' &&
      delivery.district.trim() !== '' &&
      delivery.city.trim() !== '' &&
      delivery.stateCode.trim() !== '' &&
      delivery.postalCode.trim() !== '');

  const canSubmit =
    consentAccepted &&
    selectedProduct !== null &&
    selectedVariant !== null &&
    isFulfillmentSupported(selectedProduct, fulfillmentMethod) &&
    guestName.trim() !== '' &&
    guestEmail.trim() !== '' &&
    deliveryComplete &&
    submitState.phase !== 'submitting';

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !selectedVariant || !canSubmit) return;

    setSubmitState({ phase: 'submitting' });

    const trimmedPhone = guestPhone.trim();

    const payload = buildCheckoutPayload({
      variantId: selectedVariant.id,
      fulfillmentMethod,
      expectedTotalCents,
      guest: {
        name: guestName.trim(),
        email: guestEmail.trim(),
        ...(trimmedPhone ? { phone: trimmedPhone } : {}),
      },
      ...(fulfillmentMethod === 'ship'
        ? {
            delivery: {
              recipientName: delivery.recipientName.trim(),
              line1: delivery.line1.trim(),
              number: delivery.number.trim(),
              district: delivery.district.trim(),
              city: delivery.city.trim(),
              stateCode: delivery.stateCode as (typeof BRAZIL_STATE_CODES)[number],
              postalCode: delivery.postalCode.trim(),
            },
          }
        : {}),
      acceptedTermsVersion: TERMS_VERSION,
      acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
    });

    startPresaleCheckout(payload)
      .then((res) => {
        window.location.href = res.checkoutUrl;
      })
      .catch((err: unknown) => {
        setSubmitState({ phase: 'error', copy: resolveCheckoutError(err) });
      });
  };

  return (
    <section id="tiers" className="flex flex-col gap-10">
      <div className="grid gap-6 sm:grid-cols-2">
        {products.map((product) => (
          <TierCard
            key={product.id}
            product={product}
            selectedVariantId={product.id === selectedProductId ? selectedVariantId : null}
            isSelected={product.id === selectedProductId}
            fulfillmentMethod={fulfillmentMethod}
            onSelectVariant={(variantId) => {
              setSelectedProductId(product.id);
              setSelectedVariantId(variantId);
            }}
            onSelect={() => handleSelectTier(product)}
          />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">{presaleCopy.fulfillment.title}</h2>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setFulfillmentMethod('pickup')}
              aria-pressed={fulfillmentMethod === 'pickup'}
              className={`rounded-full border px-5 py-2 text-sm font-semibold ${
                fulfillmentMethod === 'pickup'
                  ? 'border-accent bg-accent text-bg'
                  : 'border-border text-fg-secondary'
              }`}
            >
              {presaleCopy.fulfillment.pickup}
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentMethod('ship')}
              aria-pressed={fulfillmentMethod === 'ship'}
              className={`rounded-full border px-5 py-2 text-sm font-semibold ${
                fulfillmentMethod === 'ship'
                  ? 'border-accent bg-accent text-bg'
                  : 'border-border text-fg-secondary'
              }`}
            >
              {presaleCopy.fulfillment.ship}
            </button>
          </div>

          {fulfillmentMethod === 'pickup' && campaign.pickupAddress ? (
            <div className="text-sm text-fg-secondary">
              <p>
                {presaleCopy.fulfillment.pickupAddressLabel}: {campaign.pickupAddress}
              </p>
              {campaign.pickupHours ? (
                <p>
                  {presaleCopy.fulfillment.pickupHoursLabel}: {campaign.pickupHours}
                </p>
              ) : null}
            </div>
          ) : null}

          {fulfillmentMethod === 'ship' ? (
            <div className="flex flex-col gap-3">
              {campaign.deliveryAreaLabel ? (
                <p className="text-sm text-fg-secondary">
                  {presaleCopy.fulfillment.deliveryAreaLabel(campaign.deliveryAreaLabel)}
                </p>
              ) : null}
              {campaign.shippingFeeCents > 0 ? (
                <p className="text-sm text-fg-secondary">
                  {presaleCopy.fulfillment.shippingFeeLabel(
                    fmtCurrencyCents(campaign.shippingFeeCents, selectedVariant?.currency ?? 'BRL'),
                  )}
                </p>
              ) : null}

              <h3 className="text-sm font-semibold text-fg">{presaleCopy.delivery.title}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={presaleCopy.delivery.recipientNameLabel}
                  value={delivery.recipientName}
                  onChange={(v) => setDelivery((d) => ({ ...d, recipientName: v }))}
                />
                <Field
                  label={presaleCopy.delivery.line1Label}
                  value={delivery.line1}
                  onChange={(v) => setDelivery((d) => ({ ...d, line1: v }))}
                />
                <Field
                  label={presaleCopy.delivery.numberLabel}
                  value={delivery.number}
                  onChange={(v) => setDelivery((d) => ({ ...d, number: v }))}
                />
                <Field
                  label={presaleCopy.delivery.districtLabel}
                  value={delivery.district}
                  onChange={(v) => setDelivery((d) => ({ ...d, district: v }))}
                />
                <Field
                  label={presaleCopy.delivery.cityLabel}
                  value={delivery.city}
                  onChange={(v) => setDelivery((d) => ({ ...d, city: v }))}
                />
                <label className="flex flex-col gap-1 text-sm text-fg-secondary">
                  {presaleCopy.delivery.stateCodeLabel}
                  <select
                    value={delivery.stateCode}
                    onChange={(e) => setDelivery((d) => ({ ...d, stateCode: e.target.value }))}
                    className="rounded-lg border border-border bg-surface-alt px-3 py-2 text-fg"
                  >
                    <option value="" disabled>
                      {presaleCopy.delivery.stateCodeLabel}
                    </option>
                    {BRAZIL_STATE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label={presaleCopy.delivery.postalCodeLabel}
                  value={delivery.postalCode}
                  onChange={(v) => setDelivery((d) => ({ ...d, postalCode: v }))}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-fg">{presaleCopy.guest.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={presaleCopy.guest.nameLabel} value={guestName} onChange={setGuestName} />
            <Field
              label={presaleCopy.guest.emailLabel}
              value={guestEmail}
              onChange={setGuestEmail}
              type="email"
            />
            <Field
              label={presaleCopy.guest.phoneLabel}
              value={guestPhone}
              onChange={setGuestPhone}
            />
          </div>
        </div>

        <label className="flex items-start gap-3 text-sm text-fg-secondary">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(e) => setConsentAccepted(e.target.checked)}
            className="mt-1"
          />
          <span>
            {presaleCopy.consent.prefix}
            <a href="/privacidade" className="text-accent underline">
              {presaleCopy.consent.privacyLabel}
            </a>
            {presaleCopy.consent.middle}
            <a href="/termos" className="text-accent underline">
              {presaleCopy.consent.termsLabel}
            </a>
            {presaleCopy.consent.suffix}
          </span>
        </label>

        <Faq campaign={campaign} />

        <div className="flex flex-col gap-3">
          <p className="text-lg font-semibold text-fg">
            {fmtCurrencyCents(expectedTotalCents, selectedVariant?.currency ?? 'BRL')}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex w-full items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
          >
            {submitState.phase === 'submitting'
              ? presaleCopy.checkout.submitting
              : presaleCopy.checkout.submitCta}
          </button>
          {submitState.phase === 'error' ? (
            <p className="text-sm text-accent-soft">
              {submitState.copy.title} — {submitState.copy.body}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-fg-secondary">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-surface-alt px-3 py-2 text-fg"
      />
    </label>
  );
}
