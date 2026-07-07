/**
 * Casa Car Club — brand config.
 *
 * Single source of truth for all identity-tied values: name, colors,
 * typography, URLs, social handles, and app identifiers. Switching brands
 * later = only editing this file (plus tailwind-preset.cjs which mirrors
 * the color block due to CJS constraints).
 *
 * WhatsApp number: set WHATSAPP_NUMBER env var at build/runtime.
 * All URLs below are placeholders; update before launch.
 */

export const brand = {
  name: 'Casa Car Club',
  shortName: 'CCC',
  tagline: 'Um clubhouse automotivo privado em Curitiba',
  location: 'Curitiba',

  premium: {
    productName: 'CCC Gold',
  },

  color: {
    // Primary accent — replaces JDM red across the entire UI
    brand: '#D4AF37',
    brandDeep: '#B8912A',
    brandSoft: '#E8C874',
    brandTint: 'rgba(212,175,55,0.12)',

    // Shadow/glow derived from brand
    glowBase: 'rgba(212,175,55,0.35)',
    glowStrong: 'rgba(212,175,55,0.5)',
    gradientAngle: '135deg',

    // App chrome (unchanged from JDM — dark-first)
    bg: '#0A0A0A',
    textPrimary: '#F2E8D8',
    textSecondary: '#c7bfb1',
    textMuted: '#a99f8d',
  },

  typography: {
    // CCC uses Jost (geometric sans) for display; replaces Anton.
    // Mobile: swap @expo-google-fonts/anton → @expo-google-fonts/jost
    // and update _layout.tsx imports accordingly.
    displayFont: 'Jost_300Regular',
    displayFontFamily: ['Jost_300Regular', 'sans-serif'] as const,
    displayFontNative: 'Jost_300Regular',
  },

  social: {
    instagramHandle: '@casacarclub.curitiba',
    instagramUrl: 'https://instagram.com/casacarclub.curitiba',
    // Set WHATSAPP_NUMBER (digits only, e.g. 5541999990000) via env var.
    whatsappUrl: 'https://wa.me/',
  },

  contact: {
    privacyEmail: 'privacidade@casacarclub.com.br',
    contactEmail: 'contato@casacarclub.com.br',
    legalName: 'Casa Car Club',
    dpoName: 'Pedro Leão',
    dpoTitle: 'CEO e fundador',
  },

  urls: {
    appBase: 'https://casacarclub.com.br',
    publicProfileBase: 'https://casacarclub.com.br/g',
    partnersPage: 'https://casacarclub.com.br/parceiros',
  },

  app: {
    scheme: 'ccc',
    bundleIdBase: 'com.casacarclub.app',
    // Storage key prefix — used in AsyncStorage, sessionStorage, and cookie keys.
    storagePrefix: 'ccc',
    // Merchant identifier for Apple Pay (production only)
    stripeMerchantId: 'merchant.com.casacarclub.app',
  },
} as const;

export type Brand = typeof brand;
