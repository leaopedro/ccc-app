'use server';

import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemUpdateSchema,
  adminPartnerCreateSchema,
  adminPartnerModuleCreateSchema,
  adminPartnerModuleUpdateSchema,
  adminPartnerUpdateSchema,
} from '@ccc/shared/admin-box';
import { presignRequestSchema, presignResponseSchema } from '@ccc/shared/uploads';
import { revalidatePath } from 'next/cache';

import {
  createBoxCatalogItem,
  createBoxPartner,
  createBoxPartnerModule,
  deleteBoxCatalogItem,
  deleteBoxPartner,
  deleteBoxPartnerModule,
  updateBoxCatalogItem,
  updateBoxPartner,
  updateBoxPartnerModule,
} from './admin-api';
import { ApiError, apiFetch } from './api';

type BoxImageKind = 'box_item' | 'partner_logo' | 'partner_module';

export const presignBoxImageAction = async (
  kind: BoxImageKind,
  input: { contentType: string; size: number },
) => {
  const body = presignRequestSchema.parse({ kind, ...input });
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(body),
    schema: presignResponseSchema,
  });
};

export type BoxFormState = { error: string | null };

const CATALOG_PATH = '/box/catalogo';

const zodMessage = (issues: { message: string }[]): string =>
  issues.map((i) => i.message).join('; ');
const str = (fd: FormData, key: string): string | undefined => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
};
const num = (fd: FormData, key: string): number | undefined => {
  const v = fd.get(key);
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  return Number(v);
};
const bool = (fd: FormData, key: string): boolean => fd.get(key) === 'on';

export const createBoxCatalogItemAction = async (
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminBoxCatalogItemCreateSchema.safeParse({
    slug: str(fd, 'slug'),
    title: str(fd, 'title'),
    description: str(fd, 'description'),
    priceCents: num(fd, 'priceCents'),
    category: str(fd, 'category'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    stockPerCycle: num(fd, 'stockPerCycle') ?? null,
    maxPerCycle: num(fd, 'maxPerCycle') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createBoxCatalogItem(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) return { error: 'Slug ja existe.' };
      return { error: e.message };
    }
    return { error: 'Erro ao criar item.' };
  }
  revalidatePath(CATALOG_PATH);
  return { error: null };
};

export const updateBoxCatalogItemAction = async (
  id: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminBoxCatalogItemUpdateSchema.safeParse({
    title: str(fd, 'title'),
    description: str(fd, 'description'),
    priceCents: num(fd, 'priceCents'),
    category: str(fd, 'category'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    stockPerCycle: num(fd, 'stockPerCycle') ?? null,
    maxPerCycle: num(fd, 'maxPerCycle') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxCatalogItem(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar item.' };
  }
  revalidatePath(CATALOG_PATH);
  return { error: null };
};

export const deleteBoxCatalogItemAction = async (
  id: string,
  _prev: BoxFormState,
  _fd: FormData,
): Promise<BoxFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteBoxCatalogItem(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar item.' };
  }
  revalidatePath(CATALOG_PATH);
  return { error: null };
};

// --- Partners ---

const PARTNERS_PATH = '/box/parceiros';

export const createPartnerAction = async (
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerCreateSchema.safeParse({
    slug: str(fd, 'slug'),
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    logoObjectKey: str(fd, 'logoObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createBoxPartner(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.status === 409 ? 'Slug ja existe.' : e.message };
    return { error: 'Erro ao criar parceiro.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const updatePartnerAction = async (
  id: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerUpdateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    logoObjectKey: str(fd, 'logoObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxPartner(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar parceiro.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const deletePartnerAction = async (
  id: string,
  _prev: BoxFormState,
  _fd: FormData,
): Promise<BoxFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteBoxPartner(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar parceiro.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const createPartnerModuleAction = async (
  partnerId: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerModuleCreateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    priceCents: num(fd, 'priceCents'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createBoxPartnerModule(partnerId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar modulo.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const updatePartnerModuleAction = async (
  moduleId: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerModuleUpdateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    priceCents: num(fd, 'priceCents'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxPartnerModule(moduleId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar modulo.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const deletePartnerModuleAction = async (
  moduleId: string,
  _prev: BoxFormState,
  _fd: FormData,
): Promise<BoxFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteBoxPartnerModule(moduleId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar modulo.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};
