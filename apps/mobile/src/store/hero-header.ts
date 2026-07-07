import type { StoreSettings } from '@jdm/shared/store';

export type StoreHeroHeader = Pick<StoreSettings, 'storeHeaderTitle' | 'storeHeaderSubtitle'>;

export const DEFAULT_STORE_HERO_HEADER: StoreHeroHeader = {
  storeHeaderTitle: null,
  storeHeaderSubtitle: null,
};

export const loadStoreHeroHeader = async (
  fetchStoreSettings: () => Promise<StoreSettings>,
): Promise<StoreHeroHeader> => {
  try {
    const settings = await fetchStoreSettings();
    return {
      storeHeaderTitle: settings.storeHeaderTitle,
      storeHeaderSubtitle: settings.storeHeaderSubtitle,
    };
  } catch {
    return DEFAULT_STORE_HERO_HEADER;
  }
};
