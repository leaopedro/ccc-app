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
