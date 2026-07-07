'use server';

import { adminStoreFulfillmentUpdateSchema } from '@jdm/shared/store';
import { revalidatePath } from 'next/cache';

import { updateAdminStoreOrderFulfillment } from './admin-api';
import { ApiError } from './api';
import type { StoreFormState } from './store-actions';

const blankToUndefined = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const updateOrderFulfillmentAction = async (
  orderId: string,
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const parsed = adminStoreFulfillmentUpdateSchema.safeParse({
    status: fd.get('status'),
    trackingCode: blankToUndefined(fd.get('trackingCode')),
    note: blankToUndefined(fd.get('note')),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  try {
    await updateAdminStoreOrderFulfillment(orderId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao atualizar fulfillment.' };
  }
  revalidatePath('/loja/pedidos');
  revalidatePath(`/loja/pedidos/${orderId}`);
  return { error: null };
};
