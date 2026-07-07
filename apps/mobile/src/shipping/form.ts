import { shippingAddressInputSchema, type ShippingAddressRecord } from '@jdm/shared/store';

export type ShippingAddressFormValues = {
  recipientName: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  stateCode: string;
  isDefault: boolean;
};

export const emptyShippingAddressFormValues: ShippingAddressFormValues = {
  recipientName: '',
  phone: '',
  postalCode: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  stateCode: '',
  isDefault: false,
};

export function toShippingAddressInput(
  values: ShippingAddressFormValues,
): ReturnType<typeof shippingAddressInputSchema.safeParse> {
  return shippingAddressInputSchema.safeParse({
    recipientName: values.recipientName,
    phone: values.phone,
    postalCode: values.postalCode,
    street: values.street,
    number: values.number,
    complement: values.complement.trim().length > 0 ? values.complement : null,
    neighborhood: values.neighborhood,
    city: values.city,
    stateCode: values.stateCode.toUpperCase(),
    countryCode: 'BR',
    isDefault: values.isDefault,
  });
}

export function fromShippingAddressRecord(
  address: ShippingAddressRecord,
): ShippingAddressFormValues {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    postalCode: address.postalCode,
    street: address.street,
    number: address.number,
    complement: address.complement ?? '',
    neighborhood: address.neighborhood,
    city: address.city,
    stateCode: address.stateCode,
    isDefault: address.isDefault,
  };
}
