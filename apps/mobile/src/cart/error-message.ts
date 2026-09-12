import { getApiErrorCode, getApiErrorMessage } from '../api/errors';
import { cartCopy } from '../copy/cart';

const MAX_TICKETS_RE = /max\s+(\d+)\s+ticket/i;

export function getCartAddErrorMessage(error: unknown): string {
  const code = getApiErrorCode(error);
  switch (code) {
    case 'MAX_TICKETS_EXCEEDED': {
      const raw = getApiErrorMessage(error, '');
      const match = MAX_TICKETS_RE.exec(raw);
      const max = match ? Number(match[1]) : NaN;
      return Number.isFinite(max)
        ? cartCopy.errors.maxTicketsExceeded(max)
        : cartCopy.errors.maxTicketsExceeded(1);
    }
    case 'TIER_SOLD_OUT':
      return cartCopy.errors.tierSoldOut;
    case 'SALES_NOT_OPEN':
      return cartCopy.errors.salesNotOpen;
    case 'SALES_CLOSED':
      return cartCopy.errors.salesClosed;
    case 'EXTRA_SOLD_OUT':
      return cartCopy.errors.extraSoldOut;
    case 'VARIANT_SOLD_OUT':
      return cartCopy.errors.variantSoldOut;
    case 'PENDING_TICKET_ORDER_FOR_EVENT':
      return cartCopy.errors.pendingTicketOrderForEvent;
    default:
      return getApiErrorMessage(error, cartCopy.errors.add);
  }
}

/**
 * O mesmo mapa, para o BOTAO DE PAGAR.
 *
 * `handlePay` so tratava VIRTUAL_ITEM_IOS_BLOCKED e mandava todo o resto para
 * `cartCopy.errors.checkout` ("Erro ao iniciar o pagamento"). Um 409
 * PENDING_TICKET_ORDER_FOR_EVENT, que tem copy propria desde sempre logo
 * acima, chegava ao membro como erro generico, sem dizer o que fazer. Era o
 * que fazia o pagamento de evento parecer simplesmente quebrado.
 *
 * O default e o de checkout, nao o de adicionar item: a acao que falhou aqui e
 * pagar.
 */
export function getCartCheckoutErrorMessage(error: unknown): string {
  const code = getApiErrorCode(error);
  switch (code) {
    case 'VIRTUAL_ITEM_IOS_BLOCKED':
      return cartCopy.errors.virtualItemIosBlocked;
    case 'PENDING_TICKET_ORDER_FOR_EVENT':
      return cartCopy.errors.pendingTicketOrderForEvent;
    case 'TIER_SOLD_OUT':
      return cartCopy.errors.tierSoldOut;
    case 'EXTRA_SOLD_OUT':
      return cartCopy.errors.extraSoldOut;
    case 'VARIANT_SOLD_OUT':
      return cartCopy.errors.variantSoldOut;
    case 'CART_INCOMPATIBLE_FULFILLMENT':
      return cartCopy.errors.cartIncompatibleFulfillment;
    default:
      return cartCopy.errors.checkout;
  }
}
