import { z } from 'zod';

// Regex: Unicode letters (including PT-BR accented: é ã ç etc.), digits, spaces.
// Rejects emoji, punctuation, specials.
export const nicknameRegex = /^[\p{L}\p{N} ]+$/u;

export const carInputSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z
    .number()
    .int()
    .min(1900)
    .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' }),
  nickname: z.string().trim().min(1).max(20).regex(nicknameRegex, {
    message: 'Apelido deve conter apenas letras, números e espaços',
  }),
  modifications: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type CarInput = z.infer<typeof carInputSchema>;

export const carUpdateSchema = z.object({
  make: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().min(1).max(60).optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' })
    .optional(),
  nickname: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(nicknameRegex, {
      message: 'Apelido deve conter apenas letras, números e espaços',
    })
    .optional(),
  modifications: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});
export type CarUpdateInput = z.infer<typeof carUpdateSchema>;

// `url` is server-derived from the stored objectKey via app.uploads.buildPublicUrl.
// Clients must not persist it; re-fetch cars to get fresh URLs.
export const carPhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type CarPhoto = z.infer<typeof carPhotoSchema>;

export const carSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(20),
  modifications: z.array(z.string()),
  photo: carPhotoSchema.nullable(),
  photos: z.array(carPhotoSchema),
  // Computed at API serialization time from the owner's Garage
  // (premiumTier non-null AND premiumUntil is null or in the future).
  // Persisted nowhere; clients should treat this as a read-only derived flag.
  isPremiumActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Car = z.infer<typeof carSchema>;

export const carListResponseSchema = z.object({
  cars: z.array(carSchema),
});
export type CarListResponse = z.infer<typeof carListResponseSchema>;

export const addCarPhotoSchema = z.object({
  objectKey: z.string().min(1).max(300),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type AddCarPhotoInput = z.infer<typeof addCarPhotoSchema>;
