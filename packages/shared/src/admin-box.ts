import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9-]+$/, 'slug: only lowercase, digits, hyphen');

const objectKey = z.string().trim().min(1).max(300).nullable();
const cents = z.number().int().nonnegative();
const sortOrder = z.number().int().min(0).max(100_000);

// ----- Catalog item -----

export const adminBoxCatalogItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  priceCents: z.number().int(),
  currency: z.string(),
  category: z.string(),
  imageObjectKey: z.string().nullable(),
  stockPerCycle: z.number().int().nullable(),
  maxPerCycle: z.number().int().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type AdminBoxCatalogItem = z.infer<typeof adminBoxCatalogItemSchema>;

export const adminBoxCatalogItemCreateSchema = z.object({
  slug,
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(10_000),
  priceCents: cents,
  category: z.string().trim().min(1).max(60),
  imageObjectKey: objectKey.optional(),
  stockPerCycle: z.number().int().positive().max(1_000_000).nullable().optional(),
  maxPerCycle: z.number().int().positive().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminBoxCatalogItemCreate = z.infer<typeof adminBoxCatalogItemCreateSchema>;

export const adminBoxCatalogItemUpdateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().min(1).max(10_000).optional(),
  priceCents: cents.optional(),
  category: z.string().trim().min(1).max(60).optional(),
  imageObjectKey: objectKey.optional(),
  stockPerCycle: z.number().int().positive().max(1_000_000).nullable().optional(),
  maxPerCycle: z.number().int().positive().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminBoxCatalogItemUpdate = z.infer<typeof adminBoxCatalogItemUpdateSchema>;

export const adminBoxCatalogListSchema = z.object({
  items: z.array(adminBoxCatalogItemSchema),
});
export type AdminBoxCatalogList = z.infer<typeof adminBoxCatalogListSchema>;

// ----- Partner module -----

export const adminPartnerModuleSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  currency: z.string(),
  imageObjectKey: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type AdminPartnerModule = z.infer<typeof adminPartnerModuleSchema>;

export const adminPartnerModuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  priceCents: cents,
  imageObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerModuleCreate = z.infer<typeof adminPartnerModuleCreateSchema>;

export const adminPartnerModuleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  priceCents: cents.optional(),
  imageObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerModuleUpdate = z.infer<typeof adminPartnerModuleUpdateSchema>;

// ----- Partner -----

export const adminPartnerSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoObjectKey: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  modules: z.array(adminPartnerModuleSchema),
});
export type AdminPartner = z.infer<typeof adminPartnerSchema>;

export const adminPartnerCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  logoObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerCreate = z.infer<typeof adminPartnerCreateSchema>;

export const adminPartnerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  logoObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerUpdate = z.infer<typeof adminPartnerUpdateSchema>;

export const adminPartnerListSchema = z.object({
  partners: z.array(adminPartnerSchema),
});
export type AdminPartnerList = z.infer<typeof adminPartnerListSchema>;

// ----- Box settings -----

const cep = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, 'CEP invalido');

export const cepRangeSchema = z
  .object({ from: cep, to: cep })
  .refine((r) => r.from.replace('-', '') <= r.to.replace('-', ''), {
    message: 'from deve ser <= to',
    path: ['to'],
  });
export type CepRange = z.infer<typeof cepRangeSchema>;

export const adminBoxSettingsSchema = z.object({
  boxEnabled: z.boolean(),
  cutoffDaysBeforeRenewal: z.number().int(),
  headerTitle: z.string().nullable(),
  headerSubtitle: z.string().nullable(),
  freeShippingCepRanges: z.array(cepRangeSchema),
  shippingFeeCents: z.number().int(),
});
export type AdminBoxSettings = z.infer<typeof adminBoxSettingsSchema>;

export const adminBoxSettingsUpdateSchema = z.object({
  boxEnabled: z.boolean().optional(),
  cutoffDaysBeforeRenewal: z.number().int().min(0).max(28).optional(),
  headerTitle: z.string().trim().max(140).nullable().optional(),
  headerSubtitle: z.string().trim().max(240).nullable().optional(),
  freeShippingCepRanges: z.array(cepRangeSchema).max(50).optional(),
  shippingFeeCents: z.number().int().nonnegative().optional(),
});
export type AdminBoxSettingsUpdate = z.infer<typeof adminBoxSettingsUpdateSchema>;
