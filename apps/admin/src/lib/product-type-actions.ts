'use server';

import { adminProductTypeCreateSchema, adminProductTypeUpdateSchema } from '@jdm/shared/admin';
import { revalidatePath } from 'next/cache';

import {
  createAdminProductType,
  deleteAdminProductType,
  updateAdminProductType,
} from './admin-api';
import { ApiError } from './api';

export type ProductTypeFormState = { error: string | null };

const TIPOS_PATH = '/loja/tipos';

export const createProductTypeAction = async (
  _prev: ProductTypeFormState,
  fd: FormData,
): Promise<ProductTypeFormState> => {
  const parsed = adminProductTypeCreateSchema.safeParse({
    name: fd.get('name'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await createAdminProductType(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar tipo.' };
  }
  revalidatePath(TIPOS_PATH);
  return { error: null };
};

export const updateProductTypeAction = async (
  id: string,
  _prev: ProductTypeFormState,
  fd: FormData,
): Promise<ProductTypeFormState> => {
  const raw: Record<string, unknown> = {};
  const name = fd.get('name');
  if (typeof name === 'string' && name.trim() !== '') raw.name = name;
  const sortOrder = fd.get('sortOrder');
  if (typeof sortOrder === 'string' && sortOrder !== '') {
    raw.sortOrder = Number(sortOrder);
  }
  const parsed = adminProductTypeUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await updateAdminProductType(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao atualizar tipo.' };
  }
  revalidatePath(TIPOS_PATH);
  return { error: null };
};

export const deleteProductTypeAction = async (
  id: string,
  _prev: ProductTypeFormState,
  _fd: FormData,
): Promise<ProductTypeFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteAdminProductType(id);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        return {
          error: 'Não é possível excluir: existem produtos vinculados a este tipo.',
        };
      }
      return { error: e.message };
    }
    return { error: 'Erro ao excluir tipo.' };
  }
  revalidatePath(TIPOS_PATH);
  return { error: null };
};
