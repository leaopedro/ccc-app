/**
 * Casa Car Club design tokens — single source of truth.
 *
 * Brand colors and typography are sourced from brand.ts. Values are mirrored
 * in tailwind-preset.cjs so they can be consumed by NativeWind (mobile) and
 * Tailwind v4 (admin) configs that cannot import ESM/TS at build time.
 * Keep tailwind-preset.cjs in sync with any changes here.
 */

import { brand } from './brand.js';

export const color = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceAlt: '#1F1F1F',
  border: '#2A2A2A',
  borderStrong: '#3A3A3A',

  brand: brand.color.brand,
  brandDeep: brand.color.brandDeep,
  brandSoft: brand.color.brandSoft,
  brandTint: brand.color.brandTint,

  textPrimary: brand.color.textPrimary,
  textSecondary: brand.color.textSecondary,
  textMuted: brand.color.textMuted,
  textInverse: '#FFFFFF',

  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',

  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

export const fontFamily = {
  display: brand.typography.displayFont,
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_400Regular',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 44,
  '5xl': 60,
} as const;

export const lineHeight = {
  tight: 1.1,
  snug: 1.25,
  normal: 1.5,
  relaxed: 1.65,
} as const;

export const letterSpacing = {
  tight: -0.4,
  normal: 0,
  wide: 0.6,
  wider: 1.2,
  widest: 2.4,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const shadow = {
  none: 'none',
  card: '0 8px 24px rgba(0, 0, 0, 0.4)',
  cardLg: '0 16px 40px rgba(0, 0, 0, 0.5)',
  glow: `0 0 24px ${brand.color.glowBase}`,
  glowStrong: `0 0 40px ${brand.color.glowStrong}`,
} as const;

export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
  },
} as const;

export const layout = {
  screenPadding: 20,
  cardGap: 16,
  touchTarget: 44,
} as const;

export const tokens = {
  color,
  fontFamily,
  fontSize,
  lineHeight,
  letterSpacing,
  radius,
  space,
  shadow,
  motion,
  layout,
} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof typeof color;
export type RadiusToken = keyof typeof radius;
export type SpaceToken = keyof typeof space;
