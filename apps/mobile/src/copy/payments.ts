// Copy shared by every PaymentSheet surface (cart, subscription, order
// resumption). PT-BR is primary; EN is the i18n scaffold the repo mandates.
//
// Fix round 2 (final review I1) — three keys were deleted here:
//
//   `unavailable` ('Pagamento indisponível neste aparelho. Tente pelo site.')
//     reintroduced the external-steering sentence this branch deliberately
//     removed from assinaturas.ts. It had no importer, but an unreferenced
//     string is one import away from shipping, and the 3.1.3 chapeau forbids
//     that steering outright on the Brazil storefront. A keyless build now
//     falls back to a working hosted checkout (checkout.ts, cart/index.tsx)
//     instead of telling the member to go find a website.
//
//   `authFailed` and `confirming` were unreachable. `resolveSheetOutcome`
//     (payments/payment-sheet.ts) collapses EVERY non-cancel error into
//     { kind: 'failed' }, and the only two consumers of a sheet outcome —
//     resolveCartSheetOutcomeAction and ContratarScreen.onSubmit — branch on
//     nothing but 'cancelled' / 'failed' / paid. Nothing could ever render a
//     bank-declined or a "confirming" string from this file; the confirming
//     state the subscription screen does show comes from
//     assinaturasCopy.contratar.confirming.
//
// Only add a key back here alongside the code path that reaches it.

const ptBR = {
  sheet: {
    // A closed sheet is a choice, not a failure. Never show this as an error.
    cancelled: 'Pagamento cancelado. Seu pedido continua aguardando pagamento.',
    failed: 'Não foi possível concluir o pagamento. Tente de novo ou use outro cartão.',
  },
} as const;

const en = {
  sheet: {
    cancelled: 'Payment cancelled. Your order is still awaiting payment.',
    failed: 'We could not complete the payment. Try again or use another card.',
  },
} as const;

export const paymentsCopy = ptBR;
export const paymentsCopyEn = en;
export type PaymentsCopy = typeof ptBR;
