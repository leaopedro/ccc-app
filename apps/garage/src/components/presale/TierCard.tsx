import type { PresaleFulfillmentMethod, PresaleProduct } from '@ccc/shared/presale';

import { hasSizeOptions, isFulfillmentSupported, tierContentsFor } from './selection';

import { presaleCopy } from '~/copy/presale';
import { fmtCurrencyCents } from '~/lib/format';

type Props = {
  product: PresaleProduct;
  selectedVariantId: string | null;
  isSelected: boolean;
  onSelectVariant: (variantId: string) => void;
  onSelect: () => void;
  fulfillmentMethod?: PresaleFulfillmentMethod;
};

/**
 * Seção 3 (card de tier) + seção 4 (seletor de tamanho, só quando o produto
 * tem mais de uma variante). Sem estado próprio: a seleção vive em
 * CasaInBoxCheckout, este componente só recebe props e dispara callbacks —
 * por isso não precisa de `'use client'` mesmo tendo `onClick`/`onChange`
 * (já está dentro da árvore cliente quando renderizado em produção).
 */
export function TierCard({
  product,
  selectedVariantId,
  isSelected,
  onSelectVariant,
  onSelect,
  fulfillmentMethod,
}: Props) {
  const copy = presaleCopy.tier;
  const contents = tierContentsFor(product);
  const showSizeSelector = hasSizeOptions(product);
  const variant =
    product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0] ?? null;

  const soldOut = variant ? variant.stockOnHand <= 0 : true;
  const unsupportedFulfillment = fulfillmentMethod
    ? !isFulfillmentSupported(product, fulfillmentMethod)
    : false;
  const disabled = soldOut || !variant || unsupportedFulfillment;

  return (
    <article
      className={`flex flex-col gap-4 rounded-2xl border p-6 ${
        isSelected ? 'border-accent bg-accent-tint' : 'border-border bg-surface'
      }`}
    >
      <div>
        <h3 className="text-lg font-semibold text-fg">{product.title}</h3>
        {product.shortDescription ? (
          <p className="mt-1 text-sm text-fg-secondary">{product.shortDescription}</p>
        ) : null}
      </div>

      <div>
        <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
          {copy.contentsTitle}
        </h4>
        <ul className="mt-2 flex flex-col gap-1">
          {contents.map((item) => (
            <li key={item} className="text-sm text-fg-secondary">
              {item}
            </li>
          ))}
        </ul>
      </div>

      {showSizeSelector ? (
        <label className="flex flex-col gap-1 text-sm text-fg-secondary">
          {presaleCopy.sizeSelector.label}
          <select
            value={variant?.id ?? ''}
            onChange={(event) => onSelectVariant(event.target.value)}
            className="rounded-lg border border-border bg-surface-alt px-3 py-2 text-fg"
          >
            {product.variants.map((v) => (
              <option key={v.id} value={v.id} disabled={v.stockOnHand <= 0 || !v.isActive}>
                {v.title}
                {v.stockOnHand <= 0 ? ` — ${copy.soldOut}` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-xl font-semibold text-fg">
          {variant ? fmtCurrencyCents(variant.priceCents, variant.currency) : copy.unavailable}
        </span>
        {soldOut ? (
          <span className="text-sm text-muted">{copy.soldOut}</span>
        ) : unsupportedFulfillment ? (
          <span className="text-sm text-muted">{copy.unavailable}</span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={isSelected}
        className="inline-flex w-full items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSelected ? copy.selectedCta : copy.selectCta}
      </button>
    </article>
  );
}
