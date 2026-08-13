// Caixa — shared address seeding for the review + preferences screens. Prefers
// the box's saved address (BoxView.shippingAddressId), then the account
// default, then the first address, then none.

export function pickInitialAddressId(
  boxShippingAddressId: string | null,
  addresses: { id: string; isDefault: boolean }[],
): string | null {
  if (boxShippingAddressId && addresses.some((a) => a.id === boxShippingAddressId)) {
    return boxShippingAddressId;
  }
  if (addresses.length === 0) return null;
  return addresses.find((a) => a.isDefault)?.id ?? addresses[0]!.id;
}
