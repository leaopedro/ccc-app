import { prisma } from '@jdm/db';
import {
  type CapacityDisplayPolicy,
  defaultCapacityDisplayPolicy,
  GENERAL_SETTINGS_SINGLETON_ID,
} from '@jdm/shared/general-settings';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';

export const ensureGeneralSettings = async () => {
  try {
    return await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: {},
      create: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return prisma.generalSettings.findUniqueOrThrow({
        where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      });
    }
    throw err;
  }
};

type GeneralSettingsRow = Awaited<ReturnType<typeof ensureGeneralSettings>>;

export const toCapacityDisplayPolicy = (row: GeneralSettingsRow): CapacityDisplayPolicy => ({
  tickets: {
    mode: row.ticketCapacityMode,
    thresholdPercent: row.ticketCapacityThresholdPercent,
  },
  extras: {
    mode: row.extraCapacityMode,
    thresholdPercent: row.extraCapacityThresholdPercent,
  },
  products: {
    mode: row.productCapacityMode,
    thresholdPercent: row.productCapacityThresholdPercent,
  },
});

export const loadCapacityDisplayPolicy = async (): Promise<CapacityDisplayPolicy> => {
  try {
    const row = await ensureGeneralSettings();
    return toCapacityDisplayPolicy(row);
  } catch {
    return defaultCapacityDisplayPolicy;
  }
};
