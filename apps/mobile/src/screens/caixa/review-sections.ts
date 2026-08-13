// Caixa — Revisão screen: pure derivations of the display rows + confirm gate.
// Kept out of the screen so the row mapping and the confirm-enabled rule are
// unit-testable.

import type { BoxView } from '@ccc/shared/box';

export type ReviewLine = {
  id: string;
  title: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  included: boolean;
  dropReason: string | null;
};

export function reviewItemLines(box: Pick<BoxView, 'items'>): ReviewLine[] {
  return box.items
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      id: i.catalogItemId,
      title: i.titleSnapshot,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      subtotalCents: i.subtotalCents,
      included: i.included,
      dropReason: i.dropReason,
    }));
}

export function reviewPartnerLines(box: Pick<BoxView, 'partnerItems'>): ReviewLine[] {
  return box.partnerItems
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      id: i.partnerModuleId,
      title: i.nameSnapshot,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      subtotalCents: i.subtotalCents,
      included: i.included,
      dropReason: i.dropReason,
    }));
}

export function canConfirm(
  box: { items: { quantity: number }[]; partnerItems: { quantity: number }[] },
  selectedAddressId: string | null,
): boolean {
  const hasSelection =
    box.items.some((i) => i.quantity > 0) || box.partnerItems.some((i) => i.quantity > 0);
  return hasSelection && selectedAddressId !== null;
}
