'use server';

import {
  adminStoreProductCreateSchema,
  adminStoreProductUpdateSchema,
  adminStoreVariantCreateSchema,
  adminStoreVariantUpdateSchema,
  type AdminStoreVariantAttributes,
} from '@jdm/shared/admin';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createAdminStoreProduct,
  createAdminStoreProductPhoto,
  createAdminStoreVariant,
  deleteAdminStoreProductPhoto,
  deleteAdminStoreVariant,
  updateAdminStoreProduct,
  updateAdminStoreVariant,
} from './admin-api';
import { ApiError } from './api';
import { toNumber } from './form-helpers';

export type StoreFormValues = Record<string, string>;
export type StoreFormState = { error: string | null; values?: StoreFormValues };

const captureValues = (fd: FormData): StoreFormValues => {
  const out: StoreFormValues = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
};

const issuesToMessage = (issues: { path: (string | number)[]; message: string }[]) =>
  issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

const parseAttributes = (raw: FormDataEntryValue | null): AdminStoreVariantAttributes => {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
};

export const createProductAction = async (
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const values = captureValues(fd);
  const shippingFeeRaw = fd.get('shippingFeeCents');
  const shippingFeeCents =
    typeof shippingFeeRaw === 'string' && shippingFeeRaw !== '' ? Number(shippingFeeRaw) : null;
  const parsed = adminStoreProductCreateSchema.safeParse({
    slug: fd.get('slug'),
    title: fd.get('title'),
    description: fd.get('description'),
    productTypeId: fd.get('productTypeId'),
    basePriceCents: toNumber(fd.get('basePriceCents')),
    currency: (fd.get('currency') as string) || 'BRL',
    allowPickup: fd.get('allowPickup') === 'true',
    allowShip: fd.get('allowShip') === 'true',
    shippingFeeCents,
  });
  if (!parsed.success) {
    return { error: issuesToMessage(parsed.error.issues), values };
  }
  let created;
  try {
    created = await createAdminStoreProduct(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao criar produto.', values };
  }
  revalidatePath('/loja/produtos');
  redirect(`/loja/produtos/${created.id}`);
};

export const updateProductAction = async (
  id: string,
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const values = captureValues(fd);
  const raw: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'productTypeId', 'currency']) {
    const v = fd.get(key);
    if (typeof v === 'string' && v !== '') raw[key] = v;
  }
  const basePrice = fd.get('basePriceCents');
  if (typeof basePrice === 'string' && basePrice !== '') raw.basePriceCents = Number(basePrice);
  const allowPickup = fd.get('allowPickup');
  if (typeof allowPickup === 'string') raw.allowPickup = allowPickup === 'true';
  const allowShip = fd.get('allowShip');
  if (typeof allowShip === 'string') raw.allowShip = allowShip === 'true';
  const shippingFee = fd.get('shippingFeeCents');
  if (typeof shippingFee === 'string') {
    raw.shippingFeeCents = shippingFee === '' ? null : Number(shippingFee);
  }
  const status = fd.get('status');
  if (typeof status === 'string' && status !== '') raw.status = status;

  const parsed = adminStoreProductUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: issuesToMessage(parsed.error.issues), values };
  }
  try {
    await updateAdminStoreProduct(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao salvar produto.', values };
  }
  revalidatePath('/loja/produtos');
  revalidatePath(`/loja/produtos/${id}`);
  return { error: null };
};

export const archiveProductAction = async (id: string): Promise<StoreFormState> => {
  try {
    await updateAdminStoreProduct(id, { status: 'archived' });
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao arquivar.' };
  }
  revalidatePath('/loja/produtos');
  revalidatePath(`/loja/produtos/${id}`);
  return { error: null };
};

export const activateProductAction = async (id: string): Promise<StoreFormState> => {
  try {
    await updateAdminStoreProduct(id, { status: 'active' });
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao ativar.' };
  }
  revalidatePath('/loja/produtos');
  revalidatePath(`/loja/produtos/${id}`);
  return { error: null };
};

export const createVariantAction = async (
  productId: string,
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const values = captureValues(fd);
  const parsed = adminStoreVariantCreateSchema.safeParse({
    name: fd.get('name'),
    sku: fd.get('sku'),
    priceCents: toNumber(fd.get('priceCents')),
    quantityTotal: toNumber(fd.get('quantityTotal')),
    attributes: parseAttributes(fd.get('attributes')),
    active: fd.get('active') !== 'false',
  });
  if (!parsed.success) {
    return { error: issuesToMessage(parsed.error.issues), values };
  }
  try {
    await createAdminStoreVariant(productId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao criar variante.', values };
  }
  revalidatePath(`/loja/produtos/${productId}`);
  return { error: null, values: {} };
};

export const updateVariantAction = async (
  productId: string,
  variantId: string,
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const values = captureValues(fd);
  const raw: Record<string, unknown> = {};
  const name = fd.get('name');
  if (typeof name === 'string' && name !== '') raw.name = name;
  const sku = fd.get('sku');
  if (typeof sku === 'string') raw.sku = sku === '' ? null : sku;
  const price = fd.get('priceCents');
  if (typeof price === 'string' && price !== '') raw.priceCents = Number(price);
  const qty = fd.get('quantityTotal');
  if (typeof qty === 'string' && qty !== '') raw.quantityTotal = Number(qty);
  const attrs = fd.get('attributes');
  if (typeof attrs === 'string') raw.attributes = parseAttributes(attrs);
  const active = fd.get('active');
  if (typeof active === 'string') raw.active = active === 'true';

  const parsed = adminStoreVariantUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: issuesToMessage(parsed.error.issues), values };
  }
  try {
    await updateAdminStoreVariant(variantId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao salvar variante.', values };
  }
  revalidatePath(`/loja/produtos/${productId}`);
  return { error: null };
};

export const updateInventoryAction = async (
  variantId: string,
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const values = captureValues(fd);
  const raw = fd.get('quantityTotal');
  if (typeof raw !== 'string' || raw === '') {
    return { error: 'Informe o estoque total.', values };
  }
  const parsed = adminStoreVariantUpdateSchema.safeParse({ quantityTotal: Number(raw) });
  if (!parsed.success) {
    return { error: issuesToMessage(parsed.error.issues), values };
  }
  try {
    await updateAdminStoreVariant(variantId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao atualizar estoque.', values };
  }
  revalidatePath('/loja/estoque');
  return { error: null };
};

export const deleteVariantAction = async (
  productId: string,
  variantId: string,
): Promise<StoreFormState> => {
  try {
    await deleteAdminStoreVariant(variantId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao remover variante.' };
  }
  revalidatePath(`/loja/produtos/${productId}`);
  return { error: null };
};

export const addProductPhotoAction = async (
  productId: string,
  input: { objectKey: string; sortOrder: number },
): Promise<StoreFormState> => {
  try {
    await createAdminStoreProductPhoto(productId, input);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao anexar foto.' };
  }
  revalidatePath(`/loja/produtos/${productId}`);
  return { error: null };
};

export const removeProductPhotoAction = async (
  productId: string,
  photoId: string,
): Promise<StoreFormState> => {
  try {
    await deleteAdminStoreProductPhoto(productId, photoId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao remover foto.' };
  }
  revalidatePath(`/loja/produtos/${productId}`);
  return { error: null };
};
