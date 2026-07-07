'use server';

import {
  adminStoreCollectionCreateSchema,
  adminStoreCollectionUpdateSchema,
} from '@jdm/shared/admin';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createAdminCollection,
  deleteAdminCollection,
  reorderAdminCollections,
  setAdminCollectionProducts,
  updateAdminCollection,
} from './admin-api';
import { ApiError } from './api';

export type CollectionFormValues = Record<string, string>;
export type CollectionFormState = { error: string | null; values?: CollectionFormValues };

const captureValues = (fd: FormData): CollectionFormValues => {
  const out: CollectionFormValues = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
};

const toBoolFlag = (raw: FormDataEntryValue | null): boolean => raw === 'on' || raw === 'true';

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    if (error.code === 'SlugTaken') return 'Slug já está em uso.';
    return error.message;
  }
  return fallback;
};

export const createCollectionAction = async (
  _prev: CollectionFormState,
  fd: FormData,
): Promise<CollectionFormState> => {
  const values = captureValues(fd);
  const parsed = adminStoreCollectionCreateSchema.safeParse({
    slug: fd.get('slug'),
    name: fd.get('name'),
    description: fd.get('description'),
    active: toBoolFlag(fd.get('active')),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      values,
    };
  }
  let created;
  try {
    created = await createAdminCollection(parsed.data);
  } catch (e) {
    return { error: errorMessage(e, 'Erro ao criar coleção.'), values };
  }
  revalidatePath('/loja/colecoes');
  redirect(`/loja/colecoes/${created.id}`);
};

export const updateCollectionAction = async (
  id: string,
  _prev: CollectionFormState,
  fd: FormData,
): Promise<CollectionFormState> => {
  const values = captureValues(fd);
  const raw: Record<string, unknown> = {};
  const slug = fd.get('slug');
  if (typeof slug === 'string' && slug !== '') raw.slug = slug;
  const name = fd.get('name');
  if (typeof name === 'string' && name !== '') raw.name = name;
  const description = fd.get('description');
  if (typeof description === 'string') raw.description = description;
  raw.active = toBoolFlag(fd.get('active'));
  const sortOrder = fd.get('sortOrder');
  if (typeof sortOrder === 'string' && sortOrder !== '') raw.sortOrder = Number(sortOrder);

  const parsed = adminStoreCollectionUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      values,
    };
  }
  try {
    await updateAdminCollection(id, parsed.data);
  } catch (e) {
    return { error: errorMessage(e, 'Erro ao atualizar coleção.'), values };
  }
  revalidatePath('/loja/colecoes');
  revalidatePath(`/loja/colecoes/${id}`);
  return { error: null, values };
};

export const deleteCollectionAction = async (id: string): Promise<void> => {
  await deleteAdminCollection(id);
  revalidatePath('/loja/colecoes');
  redirect('/loja/colecoes');
};

export const reorderCollectionsAction = async (ids: string[]): Promise<void> => {
  await reorderAdminCollections(ids);
  revalidatePath('/loja/colecoes');
};

export const setCollectionProductsAction = async (
  id: string,
  productIds: string[],
): Promise<{ error: string | null }> => {
  try {
    await setAdminCollectionProducts(id, productIds);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'ProductNotFound') return { error: 'Produto não encontrado.' };
      if (e.code === 'DuplicateProduct') return { error: 'Produto duplicado.' };
      return { error: e.message };
    }
    return { error: 'Erro ao atualizar produtos.' };
  }
  revalidatePath(`/loja/colecoes/${id}`);
  return { error: null };
};
