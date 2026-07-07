'use server';

import { adminExtraCreateSchema, adminExtraUpdateSchema } from '@jdm/shared/admin';
import { revalidatePath } from 'next/cache';

import { createExtra, deleteExtra, updateExtra } from './admin-api';
import { ApiError } from './api';
import { toNumber } from './form-helpers';

export type ExtraFormState = { error: string | null };

export const createExtraAction = async (
  eventId: string,
  _prev: ExtraFormState,
  fd: FormData,
): Promise<ExtraFormState> => {
  const qtyRaw = fd.get('quantityTotal');
  const qtyVal = typeof qtyRaw === 'string' && qtyRaw.trim() !== '' ? Number(qtyRaw) : null;

  const parsed = adminExtraCreateSchema.safeParse({
    name: fd.get('name'),
    description: fd.get('description') || undefined,
    priceCents: toNumber(fd.get('priceCents')),
    quantityTotal: qtyVal,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await createExtra(eventId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar extra.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const updateExtraAction = async (
  eventId: string,
  extraId: string,
  _prev: ExtraFormState,
  fd: FormData,
): Promise<ExtraFormState> => {
  const raw: Record<string, unknown> = {};
  const name = fd.get('name');
  if (typeof name === 'string' && name !== '') raw.name = name;
  const price = fd.get('priceCents');
  if (typeof price === 'string' && price !== '') raw.priceCents = Number(price);
  const qtyRaw = fd.get('quantityTotal');
  if (qtyRaw !== null) {
    raw.quantityTotal = typeof qtyRaw === 'string' && qtyRaw.trim() !== '' ? Number(qtyRaw) : null;
  }
  raw.active = fd.get('active') === 'true';
  const sort = fd.get('sortOrder');
  if (typeof sort === 'string' && sort !== '') raw.sortOrder = Number(sort);

  const parsed = adminExtraUpdateSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  try {
    await updateExtra(extraId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar extra.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const deleteExtraAction = async (
  eventId: string,
  extraId: string,
): Promise<ExtraFormState> => {
  try {
    await deleteExtra(extraId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao remover extra.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};
