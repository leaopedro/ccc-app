// Copy shared by every PaymentSheet surface (cart, subscription, order
// resumption). PT-BR is primary; EN is the i18n scaffold the repo mandates.

const ptBR = {
  sheet: {
    // A closed sheet is a choice, not a failure. Never show this as an error.
    cancelled: 'Pagamento cancelado. Seu pedido continua aguardando pagamento.',
    failed: 'Não foi possível concluir o pagamento. Tente de novo ou use outro cartão.',
    // The 3DS web view came back but the bank did not approve.
    authFailed: 'Seu banco não autorizou a compra. Tente de novo ou use outro cartão.',
    // Confirmation is asynchronous: the webhook is what flips the order.
    confirming: 'Confirmando pagamento...',
    unavailable: 'Pagamento indisponível neste aparelho. Tente pelo site.',
  },
} as const;

const en = {
  sheet: {
    cancelled: 'Payment cancelled. Your order is still awaiting payment.',
    failed: 'We could not complete the payment. Try again or use another card.',
    authFailed: 'Your bank declined the purchase. Try again or use another card.',
    confirming: 'Confirming payment...',
    unavailable: 'Payment is unavailable on this device. Try the website.',
  },
} as const;

export const paymentsCopy = ptBR;
export const paymentsCopyEn = en;
export type PaymentsCopy = typeof ptBR;
