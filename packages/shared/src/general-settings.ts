import { z } from 'zod';

export const GENERAL_SETTINGS_SINGLETON_ID = 'general_default';
export const DEFAULT_CAPACITY_THRESHOLD_PERCENT = 15;

export const capacityDisplayModeSchema = z.enum(['absolute', 'percentage_threshold', 'hidden']);
export type CapacityDisplayMode = z.infer<typeof capacityDisplayModeSchema>;

export const capacityDisplaySurfaceSchema = z.enum(['tickets', 'extras', 'products']);
export type CapacityDisplaySurface = z.infer<typeof capacityDisplaySurfaceSchema>;

export const capacityAvailabilityStatusSchema = z.enum(['available', 'sold_out', 'unavailable']);

export const capacityDisplayDescriptorSchema = z.object({
  status: capacityAvailabilityStatusSchema,
  mode: capacityDisplayModeSchema,
  showAbsolute: z.boolean(),
  showPercentage: z.boolean(),
  remaining: z.number().int().nonnegative().nullable(),
  remainingPercent: z.number().int().min(0).max(100).nullable(),
  thresholdPercent: z.number().int().min(0).max(100),
});

const thresholdPercentSchema = z.number().int().min(0).max(100);

// Cap at Postgres Int4 max so out-of-range values fail with a clear Zod 400
// rather than bubbling up as a Prisma write error.
const POSTGRES_INT4_MAX = 2147483647;
const defaultFreeGarageSpotsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(POSTGRES_INT4_MAX)
  .nullable();

export const capacityDisplaySurfaceSettingSchema = z.object({
  mode: capacityDisplayModeSchema,
  thresholdPercent: thresholdPercentSchema,
});
export type CapacityDisplaySurfaceSetting = z.infer<typeof capacityDisplaySurfaceSettingSchema>;

export const capacityDisplayPolicySchema = z.object({
  tickets: capacityDisplaySurfaceSettingSchema,
  extras: capacityDisplaySurfaceSettingSchema,
  products: capacityDisplaySurfaceSettingSchema,
});
export type CapacityDisplayPolicy = z.infer<typeof capacityDisplayPolicySchema>;

export const generalSettingsSchema = z.object({
  id: z.string().min(1),
  capacityDisplay: capacityDisplayPolicySchema,
  defaultFreeGarageSpots: defaultFreeGarageSpotsSchema,
  // Conquistas killswitch. Defaults to true at the DB layer. When false, every
  // gamification surface returns `enabled: false` + empty arrays and writes
  // are rejected. Admin toggles must propagate in < 1s — the API helper
  // re-reads on every call (no cache).
  gamificationEnabled: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

export const capacityDisplaySurfaceUpdateSchema = z
  .object({
    mode: capacityDisplayModeSchema.optional(),
    thresholdPercent: thresholdPercentSchema.optional(),
  })
  .strict();
export type CapacityDisplaySurfaceUpdate = z.infer<typeof capacityDisplaySurfaceUpdateSchema>;

export const generalSettingsUpdateSchema = z
  .object({
    capacityDisplay: z
      .object({
        tickets: capacityDisplaySurfaceUpdateSchema.optional(),
        extras: capacityDisplaySurfaceUpdateSchema.optional(),
        products: capacityDisplaySurfaceUpdateSchema.optional(),
      })
      .strict()
      .optional(),
    defaultFreeGarageSpots: defaultFreeGarageSpotsSchema.optional(),
    gamificationEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => {
      const surfaces = value.capacityDisplay;
      const capacityTouched =
        surfaces !== undefined &&
        Object.values(surfaces).some(
          (surface) =>
            surface !== undefined &&
            (surface.mode !== undefined || surface.thresholdPercent !== undefined),
        );
      const garageTouched = value.defaultFreeGarageSpots !== undefined;
      const gamificationTouched = value.gamificationEnabled !== undefined;
      return capacityTouched || garageTouched || gamificationTouched;
    },
    { message: 'envie ao menos um campo para atualizar' },
  );
export type GeneralSettingsUpdate = z.infer<typeof generalSettingsUpdateSchema>;

export const defaultCapacityDisplaySurfaceSetting: CapacityDisplaySurfaceSetting = {
  mode: 'absolute',
  thresholdPercent: DEFAULT_CAPACITY_THRESHOLD_PERCENT,
};

export const defaultCapacityDisplayPolicy: CapacityDisplayPolicy = {
  tickets: defaultCapacityDisplaySurfaceSetting,
  extras: defaultCapacityDisplaySurfaceSetting,
  products: defaultCapacityDisplaySurfaceSetting,
};

export type CapacityAvailabilityStatus = 'available' | 'sold_out' | 'unavailable';

export type CapacityDisplayInput = {
  status: CapacityAvailabilityStatus;
  remaining: number | null;
  total: number | null;
};

export type CapacityDisplayDescriptor = {
  status: CapacityAvailabilityStatus;
  mode: CapacityDisplayMode;
  showAbsolute: boolean;
  showPercentage: boolean;
  remaining: number | null;
  remainingPercent: number | null;
  thresholdPercent: number;
};

export const computeCapacityDisplay = (
  input: CapacityDisplayInput,
  setting: CapacityDisplaySurfaceSetting,
): CapacityDisplayDescriptor => {
  const { status, remaining, total } = input;
  const mode = setting.mode;
  const thresholdPercent = setting.thresholdPercent;

  const remainingPercent =
    typeof remaining === 'number' && typeof total === 'number' && total > 0
      ? Math.floor((Math.max(0, remaining) / total) * 100)
      : null;

  if (status !== 'available') {
    return {
      status,
      mode,
      showAbsolute: false,
      showPercentage: false,
      remaining: null,
      remainingPercent: null,
      thresholdPercent,
    };
  }

  if (mode === 'hidden') {
    return {
      status,
      mode,
      showAbsolute: false,
      showPercentage: false,
      remaining: null,
      remainingPercent: null,
      thresholdPercent,
    };
  }

  if (mode === 'absolute') {
    return {
      status,
      mode,
      showAbsolute: true,
      showPercentage: false,
      remaining: remaining ?? null,
      remainingPercent,
      thresholdPercent,
    };
  }

  const withinThreshold = remainingPercent !== null && remainingPercent <= thresholdPercent;
  return {
    status,
    mode,
    showAbsolute: false,
    showPercentage: withinThreshold,
    remaining: null,
    remainingPercent: withinThreshold ? remainingPercent : null,
    thresholdPercent,
  };
};
