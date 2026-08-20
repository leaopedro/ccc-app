/**
 * Shared Tailwind preset — Casa Car Club design tokens.
 *
 * Mirrors brand values from src/brand.ts and layout values from src/tokens.ts.
 * CJS cannot import ESM/TS, so brand color changes must be made in both files.
 * Consumed by NativeWind (mobile) and Tailwind v4 (admin) configs.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0A',
        surface: '#141414',
        'surface-alt': '#1F1F1F',
        border: '#2A2A2A',
        'border-strong': '#3A3A3A',

        // brand.color.* — keep in sync with src/brand.ts
        brand: {
          DEFAULT: '#D4AF37',
          deep: '#B8912A',
          soft: '#E8C874',
          tint: 'rgba(212,175,55,0.12)',
        },

        // Paleta do handoff da tela de Início — espelha src/tokens.ts.
        gold: {
          deep: '#C9A227',
          light: '#E8CE86',
        },
        'surface-gold': '#0F0E0B',
        hairline: {
          gold: 'rgba(212,175,55,0.14)',
          'gold-strong': 'rgba(212,175,55,0.28)',
        },

        fg: {
          DEFAULT: '#F2E8D8',
          secondary: '#c7bfb1',
          muted: '#a99f8d',
          inverse: '#FFFFFF',
        },

        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        // brand.typography.displayFont — keep in sync with src/brand.ts
        display: ['Jost_300Regular', 'sans-serif'],
        sans: ['Inter_400Regular', 'sans-serif'],
        mono: ['JetBrainsMono_400Regular', 'monospace'],
      },
      fontSize: {
        xs: 12,
        sm: 14,
        base: 16,
        lg: 18,
        xl: 20,
        '2xl': 24,
        '3xl': 32,
        '4xl': 44,
        '5xl': 60,
      },
      borderRadius: {
        none: 0,
        sm: 4,
        md: 8,
        lg: 12,
        xl: 20,
        '2xl': 28,
        full: 9999,
      },
      spacing: {
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
      },
      boxShadow: {
        card: '0 8px 24px rgba(0, 0, 0, 0.4)',
        'card-lg': '0 16px 40px rgba(0, 0, 0, 0.5)',
        // brand.color.glowBase / glowStrong — keep in sync with src/brand.ts
        glow: '0 0 24px rgba(212,175,55,0.35)',
        'glow-strong': '0 0 40px rgba(212,175,55,0.5)',
      },
      letterSpacing: {
        tight: '-0.025em',
        normal: '0',
        wide: '0.04em',
        wider: '0.08em',
        widest: '0.16em',
      },
    },
  },
};
