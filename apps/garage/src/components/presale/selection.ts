// Lógica de seleção e montagem de payload da página de venda do Casa In Box,
// extraída em funções puras para serem testadas com `environment: 'node'`
// (apps/garage/vitest.config.ts:20 — sem jsdom, sem interação de navegador).
import type {
  PresaleCampaign,
  PresaleFulfillmentMethod,
  PresaleProduct,
} from '@ccc/shared/presale';

import { presaleCopy } from '~/copy/presale';
import {
  PresaleConflictError,
  PresaleInvalidRequestError,
  type StartPresaleCheckoutInput,
} from '~/lib/presale-api';

export type TierKind = 'basic' | 'premium';

/**
 * Os dois únicos slugs que esta pré-venda reconhece. Allowlist explícita e
 * nomeada — NÃO contagem de variantes (fix-task-14-findings.md, T14-C1): no
 * dia em que o Basic ganhar uma segunda variante por um motivo alheio a
 * tamanho (uma cor, um volume de garrafa), uma heurística por contagem passa
 * a mostrar o conteúdo do Premium cobrando o preço do Basic, sem erro nenhum.
 *
 * Estes dois slugs são requisito de deploy: quem criar os produtos no admin
 * tem que usar exatamente estes valores — ver "Checklist de deploy" em
 * docs/superpowers/specs/2026-11-09-casa-in-box-presale-design.md.
 */
const PRESALE_TIER_SLUGS = {
  'casa-in-box-basic': 'basic',
  'casa-in-box-premium': 'premium',
} as const satisfies Record<string, TierKind>;

/**
 * Chaveado em `product.slug`. Slug fora da allowlist LANÇA — não degrada para
 * um tier "mais provável" nem some em silêncio. Quem liga a campanha olha a
 * página logo depois de criar os produtos no admin; um erro visível ali se
 * conserta em minutos, uma lista de conteúdo errada não se denuncia sozinha.
 */
export function classifyTier(product: PresaleProduct): TierKind {
  const kind = (PRESALE_TIER_SLUGS as Record<string, TierKind | undefined>)[product.slug];
  if (!kind) {
    throw new Error(
      `slug de produto da pré-venda não reconhecido: "${product.slug}". ` +
        `Slugs esperados: ${Object.keys(PRESALE_TIER_SLUGS).join(', ')}.`,
    );
  }
  return kind;
}

/**
 * Seletor de tamanho só aparece em produto com mais de uma variante — isso é
 * independente do tier (verdadeiro mesmo que o Basic um dia ganhe uma
 * variante de cor), e no máximo é cosmético, então continua por contagem.
 */
export function hasSizeOptions(product: PresaleProduct): boolean {
  return product.variants.length > 1;
}

/**
 * Lista de conteúdo da caixa, da copy — nunca da API (ver copy/presale.ts).
 * Propaga o throw de `classifyTier` para slug desconhecido de propósito.
 */
export function tierContentsFor(product: PresaleProduct): string[] {
  return presaleCopy.tierContents[classifyTier(product)];
}

export function isFulfillmentSupported(
  product: Pick<PresaleProduct, 'canPickup' | 'canShip'>,
  method: PresaleFulfillmentMethod,
): boolean {
  return method === 'ship' ? product.canShip : product.canPickup;
}

/**
 * Espelha `computePresaleTotals` em apps/api/src/services/presale/totals.ts:
 * uma linha só (quantity 1), frete cobrado uma vez e só em 'ship'. É este
 * número que vira `expectedTotalCents` no POST — se o servidor recalcular
 * diferente, o checkout volta 409 (PresaleConflictError).
 */
export function computeExpectedTotalCents(
  priceCents: number,
  fulfillmentMethod: PresaleFulfillmentMethod,
  shippingFeeCents: number,
): number {
  return priceCents + (fulfillmentMethod === 'ship' ? shippingFeeCents : 0);
}

export type FaqItem = { question: string; body: string; requiresField?: string };

/** Omite a pergunta cujo dado comercial correspondente está vazio na campanha. */
export function visibleFaqItems(items: FaqItem[], campaign: PresaleCampaign): FaqItem[] {
  const record = campaign as unknown as Record<string, unknown>;
  return items.filter((item) => {
    if (!item.requiresField) return true;
    const value = record[item.requiresField];
    return value !== null && value !== undefined && value !== '';
  });
}

export function buildCheckoutPayload(input: {
  variantId: string;
  quantity?: number;
  fulfillmentMethod: PresaleFulfillmentMethod;
  expectedTotalCents: number;
  guest: { name: string; email: string; phone?: string };
  delivery?: NonNullable<StartPresaleCheckoutInput['delivery']>;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
}): StartPresaleCheckoutInput {
  return {
    items: [{ variantId: input.variantId, quantity: input.quantity ?? 1 }],
    fulfillmentMethod: input.fulfillmentMethod,
    expectedTotalCents: input.expectedTotalCents,
    guest: input.guest,
    // Entrega não se aplica à retirada (presaleCheckoutRequestSchema rejeita
    // `delivery` presente com fulfillmentMethod 'pickup') — descarta mesmo que
    // o chamador ainda tenha o objeto do formulário em memória.
    delivery: input.fulfillmentMethod === 'ship' ? input.delivery : undefined,
    acceptedTermsVersion: input.acceptedTermsVersion,
    acceptedPrivacyVersion: input.acceptedPrivacyVersion,
  };
}

export type CheckoutErrorCopy = { title: string; body: string };

/**
 * 409 e 422 precisam de mensagem DIFERENTE (brief): 409 é conflito de
 * preço/estoque (recarregar), 422 é payload inválido (bug nosso, não pedir
 * para tentar de novo com o mesmo payload).
 */
export function resolveCheckoutError(err: unknown): CheckoutErrorCopy {
  if (err instanceof PresaleConflictError) return presaleCopy.errors.conflict;
  if (err instanceof PresaleInvalidRequestError) return presaleCopy.errors.invalid;
  return presaleCopy.errors.generic;
}
