import { brand } from '@ccc/design';

export const theme = {
  colors: {
    bg: '#0B0B0F',
    fg: brand.color.textPrimary,
    accent: brand.color.brand,
    success: '#22C55E',
    muted: brand.color.textMuted,
    border: '#1F1F24',
  },
  radii: { sm: 4, md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  font: {
    family: { regular: 'System', bold: 'System' },
    size: { sm: 12, md: 14, lg: 16, xl: 20, xxl: 28 },
  },
} as const;

export type Theme = typeof theme;
