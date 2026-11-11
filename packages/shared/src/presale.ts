import { z } from 'zod';

import { orderStatusSchema } from './orders.js';
import { stateCodeSchema } from './profile.js';
import { cepSchema } from './store.js';

// Items the montagem page can add to the box. Pickup at Pocket CASA or
// shipping within the area PresaleSettings covers. Distinct from
// `fulfillmentMethodSchema` in orders.ts, which also allows 'virtual'.
export const presaleFulfillmentMethodSchema = z.enum(['pickup', 'ship']);
export type PresaleFulfillmentMethod = z.infer<typeof presaleFulfillmentMethodSchema>;

export const PRESALE_MAX_QTY_PER_VARIANT = 20;

// Fixed id for the PresaleSettings singleton row, same pattern as
// STORE_SETTINGS_SINGLETON_ID above in store.ts: the API upserts by this id
// so concurrent first-hits can't create two rows. packages/db/prisma/seed.ts
// does not depend on @ccc/shared, so it keeps its own copy of this literal in
// sync by comment, same as it already does for the box/home singleton ids.
export const PRESALE_SETTINGS_SINGLETON_ID = 'presale_default';

export const presaleCampaignSchema = z.object({
  enabled: z.boolean(),
  shippingFeeCents: z.number().int().nonnegative(),
  deliveryAreaLabel: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  pickupHours: z.string().nullable(),
  firstBatchLabel: z.string().nullable(),
});
export type PresaleCampaign = z.infer<typeof presaleCampaignSchema>;

// Public variant shape for the pre-sale. Deliberately does NOT extend
// storeProductVariantSchema: that schema requires displayPriceCents and
// devFeePercent, and the pre-sale charges priceCents with zero dev fee.
export const presaleVariantSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  stockOnHand: z.number().int().nonnegative(),
  isActive: z.boolean(),
});
export type PresaleVariant = z.infer<typeof presaleVariantSchema>;

export const presaleProductSchema = z.object({
  id: z.string().min(1),
  slug: z.string().trim().min(1).max(140),
  title: z.string().trim().min(1).max(140),
  shortDescription: z.string().trim().max(280).nullable(),
  coverImageUrl: z.string().url().nullable(),
  canShip: z.boolean(),
  canPickup: z.boolean(),
  variants: z.array(presaleVariantSchema).min(1),
});
export type PresaleProduct = z.infer<typeof presaleProductSchema>;

export const presaleProductListResponseSchema = z.object({
  items: z.array(presaleProductSchema),
});
export type PresaleProductListResponse = z.infer<typeof presaleProductListResponseSchema>;

const presaleItemInputSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(PRESALE_MAX_QTY_PER_VARIANT),
});

const presaleGuestInputSchema = z.object({
  name: z.string().trim().min(1).max(140),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(20).optional(),
});

const presaleDeliveryInputSchema = z.object({
  recipientName: z.string().trim().min(1).max(140),
  line1: z.string().trim().min(1).max(140),
  number: z.string().trim().min(1).max(20),
  district: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  postalCode: cepSchema,
});
export type PresaleDeliveryInput = z.infer<typeof presaleDeliveryInputSchema>;

export const presaleCheckoutRequestSchema = z
  .object({
    clientRequestId: z.string().trim().min(1).max(64),
    expectedTotalCents: z.number().int().nonnegative(),
    fulfillmentMethod: presaleFulfillmentMethodSchema,
    items: z.array(presaleItemInputSchema).min(1).max(50),
    guest: presaleGuestInputSchema,
    delivery: presaleDeliveryInputSchema.optional(),
    acceptedTermsVersion: z.string().min(1).max(40),
    acceptedPrivacyVersion: z.string().min(1).max(40),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillmentMethod === 'ship' && !value.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endereço de entrega é obrigatório para recebimento por entrega',
        path: ['delivery'],
      });
    }

    if (value.fulfillmentMethod === 'pickup' && value.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endereço de entrega não se aplica à retirada',
        path: ['delivery'],
      });
    }
  });
export type PresaleCheckoutRequest = z.infer<typeof presaleCheckoutRequestSchema>;

export const presaleCheckoutResponseSchema = z.object({
  orderId: z.string().min(1),
  checkoutUrl: z.string().url(),
  amountCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type PresaleCheckoutResponse = z.infer<typeof presaleCheckoutResponseSchema>;

export const presaleOrderStatusRequestSchema = z.object({
  orderId: z.string().min(1),
  token: z.string().min(1),
});
export type PresaleOrderStatusRequest = z.infer<typeof presaleOrderStatusRequestSchema>;

const presaleOrderItemSchema = z.object({
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(),
});
export type PresaleOrderItem = z.infer<typeof presaleOrderItemSchema>;

// The /obrigado page distinguishes four states, not three: pending (still
// processing), paid (confirmed), refunded (the favorited-link case an admin
// refund days later produces), and failed/expired/cancelled (try again).
export const presaleOrderStatusResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  fulfillmentMethod: presaleFulfillmentMethodSchema,
  amountCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  items: z.array(presaleOrderItemSchema),
  delivery: presaleDeliveryInputSchema.nullable(),
});
export type PresaleOrderStatusResponse = z.infer<typeof presaleOrderStatusResponseSchema>;

// Faixa de CEP coberta pela entrega. UMA definição, importada pelo admin
// (`adminPresaleSettingsSchema` em admin.ts) e pelo checkout da API
// (services/presale/checkout.ts). Nunca redigite o shape: o admin gravava
// `{start,end}` e o checkout lia `{from,to}`, então o primeiro operador que
// configurasse uma faixa pelo admin derrubava TODO checkout com entrega.
// `{start,end}` é a grafia escolhida porque é a que já está persistida.
export const presaleCepRangeSchema = z.object({
  start: z.string(),
  end: z.string(),
});
export type PresaleCepRange = z.infer<typeof presaleCepRangeSchema>;

export const presaleCepRangesSchema = z.array(presaleCepRangeSchema);
export type PresaleCepRanges = z.infer<typeof presaleCepRangesSchema>;

// Nomes dos parâmetros da querystring da página de status do pedido. A API
// monta a URL (success_url da Stripe e link do e-mail de confirmação) e o
// app garage a lê; eram dois arquivos diferentes digitando o nome à mão, e
// discordaram (`t` contra `token`), então 100% de quem pagava caía na tela
// de "faltam parâmetros". Importe daqui dos dois lados.
export const PRESALE_ORDER_STATUS_QUERY = {
  orderId: 'orderId',
  token: 't',
} as const;

// Rotas do app garage que a API precisa montar por fora (success_url,
// cancel_url, link do e-mail). Mesma razão da constante acima: o cancel_url
// apontava para `/casa-in-box/montar`, rota do builder que a emenda de
// 2026-11-10 adiou, e o comprador que clicava em voltar na Stripe tomava 404.
export const PRESALE_GARAGE_PATHS = {
  landing: '/casa-in-box',
  orderStatus: '/casa-in-box/obrigado',
} as const;

/** Monta a URL da página de status do pedido a partir da base do garage.
 *  Único lugar que conhece rota e nomes de parâmetro juntos: o success_url
 *  da Stripe (services/presale/checkout.ts) e o link do e-mail de
 *  confirmação (services/presale/confirmation-email.ts) chamam esta função
 *  em vez de montar a string cada um do seu jeito. */
export const presaleOrderStatusUrl = (
  garageBaseUrl: string,
  orderId: string,
  token: string,
): string => {
  const base = garageBaseUrl.replace(/\/+$/, '');
  const query = new URLSearchParams({
    [PRESALE_ORDER_STATUS_QUERY.orderId]: orderId,
    [PRESALE_ORDER_STATUS_QUERY.token]: token,
  });
  return `${base}${PRESALE_GARAGE_PATHS.orderStatus}?${query.toString()}`;
};
