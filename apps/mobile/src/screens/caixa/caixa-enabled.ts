export const CAIXA_BUILD_ENABLED = process.env.EXPO_PUBLIC_CAIXA_ENABLED === 'true';
export const isCaixaBuildEnabled = (): boolean => CAIXA_BUILD_ENABLED;
