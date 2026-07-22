'use server';

import {
  adminPremiumAddonModuleCreateSchema,
  adminPremiumAddonModuleUpdateSchema,
  adminPremiumBenefitsReplaceSchema,
  adminPremiumPlanCreateSchema,
  adminPremiumPlanUpdateSchema,
  adminPremiumPriceUpsertSchema,
} from '@jdm/shared/admin';
import { revalidatePath } from 'next/cache';

import {
  createAdminPremiumModule,
  createAdminPremiumPlan,
  deleteAdminPremiumModule,
  deleteAdminPremiumPlan,
  replaceAdminPremiumBenefits,
  updateAdminPremiumModule,
  updateAdminPremiumPlan,
  upsertAdminPremiumPrice,
} from './admin-api';
import { ApiError } from './api';

export type PremiumFormState = { error: string | null };

const PREMIUM_PATH = '/premium/catalogo';

const zodMessage = (issues: { message: string }[]): string =>
  issues.map((i) => i.message).join('; ');

const str = (fd: FormData, key: string): string | undefined => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : undefined;
};

const num = (fd: FormData, key: string): number | undefined => {
  const v = fd.get(key);
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  return Number(v);
};

const bool = (fd: FormData, key: string): boolean => fd.get(key) === 'on';

// ── Plans ──────────────────────────────────────────────────────────

export const createPlanAction = async (
  _prev: PremiumFormState,
  fd: FormData,
): Promise<PremiumFormState> => {
  const parsed = adminPremiumPlanCreateSchema.safeParse({
    tier: str(fd, 'tier'),
    slug: str(fd, 'slug'),
    name: str(fd, 'name'),
    description: str(fd, 'description'),
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createAdminPremiumPlan(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) return { error: 'Tier ou slug já existe.' };
      return { error: e.message };
    }
    return { error: 'Erro ao criar plano.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

export const updatePlanAction = async (
  id: string,
  _prev: PremiumFormState,
  fd: FormData,
): Promise<PremiumFormState> => {
  const parsed = adminPremiumPlanUpdateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description'),
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateAdminPremiumPlan(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar plano.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

export const deletePlanAction = async (
  id: string,
  _prev: PremiumFormState,
  _fd: FormData,
): Promise<PremiumFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteAdminPremiumPlan(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar plano.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

// ── Prices ─────────────────────────────────────────────────────────

export const upsertPriceAction = async (
  id: string,
  _prev: PremiumFormState,
  fd: FormData,
): Promise<PremiumFormState> => {
  const cadence = str(fd, 'cadence') === 'annual' ? 'annual' : 'monthly';
  const parsed = adminPremiumPriceUpsertSchema.safeParse({
    baseAmountCents: num(fd, 'baseAmountCents'),
    currency: str(fd, 'currency') || 'BRL',
    stripePriceId: str(fd, 'stripePriceId'),
    rcProductId: str(fd, 'rcProductId'),
    active: bool(fd, 'active'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await upsertAdminPremiumPrice(id, cadence, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar preço.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

// ── Benefits ───────────────────────────────────────────────────────

export const replaceBenefitsAction = async (
  id: string,
  _prev: PremiumFormState,
  fd: FormData,
): Promise<PremiumFormState> => {
  let raw: unknown = [];
  const json = str(fd, 'benefits');
  if (json) {
    try {
      raw = JSON.parse(json);
    } catch {
      return { error: 'Benefícios inválidos.' };
    }
  }
  const parsed = adminPremiumBenefitsReplaceSchema.safeParse({ benefits: raw });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await replaceAdminPremiumBenefits(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar benefícios.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

// ── Addon modules ──────────────────────────────────────────────────

export const createModuleAction = async (
  _prev: PremiumFormState,
  fd: FormData,
): Promise<PremiumFormState> => {
  const parsed = adminPremiumAddonModuleCreateSchema.safeParse({
    key: str(fd, 'key'),
    name: str(fd, 'name'),
    description: str(fd, 'description'),
    monthlyDeltaCents: num(fd, 'monthlyDeltaCents'),
    quotaPerCycle: num(fd, 'quotaPerCycle'),
    quotaUnit: str(fd, 'quotaUnit'),
    currency: str(fd, 'currency') || 'BRL',
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
    stripePriceId: str(fd, 'stripePriceId'),
    rcProductId: str(fd, 'rcProductId'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createAdminPremiumModule(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) return { error: 'Chave já existe.' };
      return { error: e.message };
    }
    return { error: 'Erro ao criar módulo.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

export const updateModuleAction = async (
  id: string,
  _prev: PremiumFormState,
  fd: FormData,
): Promise<PremiumFormState> => {
  const parsed = adminPremiumAddonModuleUpdateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description'),
    monthlyDeltaCents: num(fd, 'monthlyDeltaCents'),
    quotaPerCycle: num(fd, 'quotaPerCycle'),
    quotaUnit: str(fd, 'quotaUnit'),
    currency: str(fd, 'currency') || 'BRL',
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
    stripePriceId: str(fd, 'stripePriceId'),
    rcProductId: str(fd, 'rcProductId'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateAdminPremiumModule(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar módulo.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};

export const deleteModuleAction = async (
  id: string,
  _prev: PremiumFormState,
  _fd: FormData,
): Promise<PremiumFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteAdminPremiumModule(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar módulo.' };
  }
  revalidatePath(PREMIUM_PATH);
  return { error: null };
};
