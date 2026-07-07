// JDM Experience — Garagem · Atoms
// Brand-locked to packages/design tokens. Extends the JDMA-587/554 vocabulary
// with new garage primitives: parking-stall card, cover image, identity card,
// 3 PremiumBadge directions, and the premium tier system (bronze/silver/gold).
//
// All components target the existing @jdm/ui surface. Style choices map 1:1
// to either an existing token or a documented additive token in HANDOFF.md.

const JDM = {
  // ── Existing tokens (do not edit) ──────────────────────────────────
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceAlt: '#1F1F1F',
  surfaceDeep: '#0F0F0F',
  border: '#2A2A2A',
  borderStrong: '#3A3A3A',
  brand: '#E10600',
  brandDeep: '#A30400',
  brandSoft: '#FF1A0D',
  brandTint: 'rgba(225,6,0,0.12)',
  text: '#F5F5F5',
  textSec: '#C9C9CD',
  textMut: '#8A8A93',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  fontDisplay: '"Anton", "Oswald", Impact, sans-serif',
  fontSans: '"Inter", -apple-system, system-ui, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, monospace',

  // ── Additive: tier tokens (HANDOFF.md §3.2) ───────────────────────
  bronze: '#C58A52',
  bronzeDeep: '#7A4F2E',
  bronzeTint: 'rgba(197,138,82,0.14)',
  silver: '#D6D8DC',
  silverDeep: '#7C8088',
  silverTint: 'rgba(214,216,220,0.14)',
  gold: '#E8B339',
  goldDeep: '#8C6712',
  goldTint: 'rgba(232,179,57,0.16)',

  // ── Additive: stall paint tokens (HANDOFF.md §3.3) ────────────────
  paintFree: '#9AA0AC',
  paintExtra: '#E8B339',
  paintAdmin: '#4AD4E0',
  asphalt: '#15161A',
  asphaltLine: '#2C2D32',
};

// ─────────────────────────────────────────────────────────────
// Sample data — public-safe shapes (mirrors CarPublic + GaragePublic)
// ─────────────────────────────────────────────────────────────

const SAMPLE_CARS = [
  {
    id: 'c1',
    nickname: 'Hachi',
    make: 'Toyota',
    model: 'AE86 Trueno',
    year: 1986,
    mods: ['4A-GE NA', 'Watanabe 14"'],
    tone: '#2a2a2a',
    accent: '#e0e0e0',
  },
  {
    id: 'c2',
    nickname: 'Godzilla',
    make: 'Nissan',
    model: 'Skyline GT-R R32',
    year: 1991,
    mods: ['RB26 single turbo', 'coilover'],
    tone: '#1a3a52',
    accent: '#4a9eff',
  },
  {
    id: 'c3',
    nickname: 'Supra MK4',
    make: 'Toyota',
    model: 'Supra MK4',
    year: 1997,
    mods: ['2JZ stock', 'escape full'],
    tone: '#3a1a1a',
    accent: '#ff7a3a',
  },
  {
    id: 'c4',
    nickname: 'Wankel',
    make: 'Mazda',
    model: 'RX-7 FD',
    year: 1995,
    mods: ['Single turbo', 'FMIC'],
    tone: '#2a1a2a',
    accent: '#ffd24a',
  },
  {
    id: 'c5',
    nickname: 'EG',
    make: 'Honda',
    model: 'Civic EG',
    year: 1994,
    mods: ['Swap K20A'],
    tone: '#1f2f1a',
    accent: '#9ee04a',
  },
  {
    id: 'c6',
    nickname: 'Bug-Eye',
    make: 'Subaru',
    model: 'Impreza GC8',
    year: 1998,
    mods: ['STi swap', 'Invidia'],
    tone: '#1a2a3a',
    accent: '#4ad4e0',
  },
];

const COVER_PRESETS = [
  {
    slug: 'default-door',
    label: 'Garage Door · Default',
    premium: false,
    hues: ['#1F1F1F', '#0A0A0A'],
    stripe: '#E10600',
    note: 'Padrão para todos os usuários.',
  },
  {
    slug: 'urban-night',
    label: 'Urban Night',
    premium: true,
    hues: ['#0d1e3a', '#04060f'],
    stripe: '#4a9eff',
    note: 'Curitiba às 23h, sob neon.',
  },
  {
    slug: 'tokyo-wangan',
    label: 'Tokyo Wangan',
    premium: true,
    hues: ['#1a0606', '#0a0a0a'],
    stripe: '#E10600',
    note: 'Bayshore route, taillights.',
  },
  {
    slug: 'kanjo-loop',
    label: 'Kanjo Loop',
    premium: true,
    hues: ['#0d0d0d', '#1a1208'],
    stripe: '#ffd24a',
    note: 'Osaka under sodium light.',
  },
  {
    slug: 'tsukuba',
    label: 'Tsukuba Dawn',
    premium: true,
    hues: ['#1c1822', '#0a0a0a'],
    stripe: '#9ee04a',
    note: 'Pit lane, motor ainda frio.',
  },
  {
    slug: 'paddock',
    label: 'Paddock',
    premium: true,
    hues: ['#0e1a14', '#050807'],
    stripe: '#22C55E',
    note: 'Box particular, luz de boxe.',
  },
  {
    slug: 'drift-smoke',
    label: 'Drift Smoke',
    premium: true,
    hues: ['#241a24', '#080608'],
    stripe: '#ff7a3a',
    note: 'Ebisu, last lap of the day.',
  },
  {
    slug: 'workshop',
    label: 'Workshop',
    premium: true,
    hues: ['#1a1612', '#080806'],
    stripe: '#C58A52',
    note: 'Oficina, óleo no chão.',
  },
  {
    slug: 'sunset-strip',
    label: 'Sunset Strip',
    premium: true,
    hues: ['#2a1530', '#0d0816'],
    stripe: '#ffd24a',
    note: 'Estrada interior, fim de tarde.',
  },
];

const SAMPLE_GARAGE = {
  id: 'g_caio',
  name: 'Garagem do Caio',
  slug: 'caio-jdm',
  description: 'Coleção em construção. Encontros, track days e algumas fotos sem placa.',
  isPublic: true,
  premiumTier: 'gold',
  premiumUntil: '2026-12-01T00:00:00Z',
  isPremiumActive: true,
  coverPreset: 'tokyo-wangan',
};

// ─────────────────────────────────────────────────────────────
// Lucide-style icons (1.75 stroke, matches @jdm/ui Icon conventions)
// ─────────────────────────────────────────────────────────────

const Icon = {
  Back: ({ s = 22 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  ),
  Share: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
  Pencil: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  ),
  Plus: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  ),
  Image: ({ s = 16 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  Lock: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Globe: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 0 20" />
      <path d="M12 2a15 15 0 0 0 0 20" />
    </svg>
  ),
  Check: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  Close: ({ s = 18 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  ChevronRight: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  Key: ({ s = 12 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  ),
  Sparkle: ({ s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
    </svg>
  ),
  Clock: ({ s = 12 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  Garage: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21V9l9-6 9 6v12" />
      <path d="M3 21h18" />
      <path d="M6 13h12v8H6z" />
      <path d="M6 17h12" />
    </svg>
  ),
  ShoppingCart: ({ s = 16 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  Pix: ({ s = 16 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 2 12l10 10 10-10L12 2zm0 4.2 5.8 5.8L12 17.8 6.2 12 12 6.2z" />
    </svg>
  ),
  Upload: ({ s = 14 }) => (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Pill — reused from JDMA-587
// ─────────────────────────────────────────────────────────────

function Pill({ children, brand = false, mono = false, tone, style = {} }) {
  const toneStyles =
    tone === 'warning'
      ? {
          background: 'rgba(245,158,11,0.12)',
          color: '#FFC04A',
          border: '1px solid rgba(245,158,11,0.35)',
        }
      : tone === 'success'
        ? {
            background: 'rgba(34,197,94,0.12)',
            color: '#5DE08A',
            border: '1px solid rgba(34,197,94,0.35)',
          }
        : tone === 'danger'
          ? {
              background: 'rgba(239,68,68,0.12)',
              color: '#FF8A8A',
              border: '1px solid rgba(239,68,68,0.35)',
            }
          : brand
            ? {
                background: JDM.brandTint,
                color: '#FF6A60',
                border: '1px solid rgba(225,6,0,0.35)',
              }
            : { background: JDM.surfaceAlt, color: JDM.textSec, border: `1px solid ${JDM.border}` };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 8px',
        borderRadius: 999,
        fontFamily: mono ? JDM.fontMono : JDM.fontSans,
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: mono ? 0 : 1.4,
        textTransform: mono ? 'none' : 'uppercase',
        ...toneStyles,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Tier colors helper — used by PremiumBadge variants
// ─────────────────────────────────────────────────────────────

function tierColors(tier) {
  if (tier === 'gold')
    return { main: JDM.gold, deep: JDM.goldDeep, tint: JDM.goldTint, label: 'Premium Gold' };
  if (tier === 'silver')
    return {
      main: JDM.silver,
      deep: JDM.silverDeep,
      tint: JDM.silverTint,
      label: 'Premium Silver',
    };
  if (tier === 'bronze')
    return {
      main: JDM.bronze,
      deep: JDM.bronzeDeep,
      tint: JDM.bronzeTint,
      label: 'Premium Bronze',
    };
  return { main: JDM.brand, deep: JDM.brandDeep, tint: JDM.brandTint, label: 'Premium' };
}

// ─────────────────────────────────────────────────────────────
// PremiumBadge — three design directions (toggle via tweaks.badgeVariant)
// ─────────────────────────────────────────────────────────────

// V1 — Sparkle chip (closest to current red-brand badge; adds sparkle glyph,
//      tappable, near-expiry adds pulsing outline).
function PremiumBadgeV1({ tier, size = 'sm', nearExpiry = false, onPress }) {
  const t = tierColors(tier);
  const h = size === 'md' ? 26 : 22;
  const fs = size === 'md' ? 11 : 10;
  return (
    <span
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : -1}
      onClick={(e) => {
        if (onPress) {
          e.stopPropagation();
          onPress();
        }
      }}
      style={{
        cursor: onPress ? 'pointer' : 'default',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: h,
        padding: '0 9px',
        borderRadius: 999,
        background: t.tint,
        color: t.main,
        border: `1px solid ${t.main}55`,
        fontFamily: JDM.fontSans,
        fontWeight: 700,
        fontSize: fs,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        position: 'relative',
        overflow: 'visible',
        boxShadow: nearExpiry ? `0 0 0 1px ${t.main}55` : 'none',
      }}
      aria-label={`${t.label}${nearExpiry ? ', expira em breve' : ''}`}
    >
      <Icon.Sparkle s={fs} />
      <span>Premium</span>
      {nearExpiry ? (
        <span
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: 999,
            border: `1px dashed ${t.main}`,
            animation: 'jdmg-pulse 1.8s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </span>
  );
}

// V2 — Tier-tinted micro-pill (bronze/silver/gold) with key glyph + tier label.
//      Near-expiry replaces sparkle with a small clock icon and 'expira em Nd'.
function PremiumBadgeV2({ tier, size = 'sm', nearExpiry = false, daysLeft = 0, onPress }) {
  const t = tierColors(tier);
  const h = size === 'md' ? 28 : 24;
  const fs = size === 'md' ? 11 : 10;
  const tierName =
    tier === 'gold' ? 'Gold' : tier === 'silver' ? 'Silver' : tier === 'bronze' ? 'Bronze' : '';
  return (
    <span
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : -1}
      onClick={(e) => {
        if (onPress) {
          e.stopPropagation();
          onPress();
        }
      }}
      style={{
        cursor: onPress ? 'pointer' : 'default',
        display: 'inline-flex',
        alignItems: 'stretch',
        height: h,
        borderRadius: 6,
        fontFamily: JDM.fontSans,
        fontWeight: 700,
        fontSize: fs,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        overflow: 'hidden',
        border: `1px solid ${t.main}66`,
      }}
      aria-label={`${t.label}${nearExpiry ? `, expira em ${daysLeft} dias` : ''}`}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 7px',
          background: t.main,
          color: '#0A0A0A',
        }}
      >
        <Icon.Key s={fs} />
        <span>{tierName || 'Premium'}</span>
      </span>
      {nearExpiry ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 7px',
            background: 'transparent',
            color: t.main,
            fontFamily: JDM.fontMono,
            letterSpacing: 0,
            textTransform: 'none',
          }}
        >
          <Icon.Clock s={fs - 1} /> {daysLeft}d
        </span>
      ) : null}
    </span>
  );
}

// V3 — Holographic chip (brand red base + iridescent gradient overlay).
//      Single visual treatment regardless of tier — tier shows only in the sheet.
function PremiumBadgeV3({ tier, size = 'sm', nearExpiry = false, onPress }) {
  const t = tierColors(tier);
  const h = size === 'md' ? 28 : 24;
  const fs = size === 'md' ? 11 : 10;
  return (
    <span
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : -1}
      onClick={(e) => {
        if (onPress) {
          e.stopPropagation();
          onPress();
        }
      }}
      style={{
        cursor: onPress ? 'pointer' : 'default',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: h,
        padding: '0 10px',
        borderRadius: 4,
        color: '#0A0A0A',
        fontFamily: JDM.fontSans,
        fontWeight: 800,
        fontSize: fs,
        letterSpacing: 2,
        textTransform: 'uppercase',
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(115deg, ${JDM.brand} 0%, ${t.main} 45%, #fff 55%, ${t.main} 65%, ${JDM.brandSoft} 100%)`,
        boxShadow: '0 0 0 1px rgba(255,255,255,0.15) inset, 0 2px 8px rgba(225,6,0,0.35)',
      }}
      aria-label={`${t.label}${nearExpiry ? ', expira em breve' : ''}`}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(45deg, rgba(255,255,255,0.0) 0 6px, rgba(255,255,255,0.10) 6px 8px)',
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />
      <Icon.Sparkle s={fs} />
      <span style={{ position: 'relative' }}>Premium</span>
    </span>
  );
}

function PremiumBadge({ variant = 'v1', ...rest }) {
  if (variant === 'v2') return <PremiumBadgeV2 {...rest} />;
  if (variant === 'v3') return <PremiumBadgeV3 {...rest} />;
  return <PremiumBadgeV1 {...rest} />;
}

// ─────────────────────────────────────────────────────────────
// Cover image — LinkedIn-style hero. Free tier uses default-door.
// Premium tier picks from COVER_PRESETS. Renders via CSS gradients
// for prototype; production swaps for R2-hosted images.
// ─────────────────────────────────────────────────────────────

function GarageCover({ presetSlug = 'default-door', height = 168 }) {
  const preset = COVER_PRESETS.find((p) => p.slug === presetSlug) ?? COVER_PRESETS[0];
  return (
    <div
      style={{
        width: '100%',
        height,
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${preset.hues[0]} 0%, ${preset.hues[1]} 100%)`,
      }}
    >
      {/* horizon line + ambient glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            `radial-gradient(70% 50% at 50% 75%, ${preset.stripe}22, transparent 60%),` +
            `radial-gradient(40% 30% at 80% 25%, ${preset.stripe}18, transparent 70%)`,
        }}
      />
      {/* grid + scanlines */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px)',
          mixBlendMode: 'overlay',
          opacity: 0.6,
        }}
      />
      {/* diagonal speed lines */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `repeating-linear-gradient(115deg, ${preset.stripe}08 0 14px, transparent 14px 60px)`,
          mixBlendMode: 'screen',
        }}
      />
      {/* preset-specific signature element — garage door for default */}
      {preset.slug === 'default-door' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `repeating-linear-gradient(0deg, ${JDM.surface} 0 14px, ${JDM.surfaceAlt} 14px 16px)`,
          }}
        />
      ) : null}
      {/* bottom legibility scrim */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '70%',
          background:
            'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.85) 100%)',
        }}
      />
      {/* corner label, monospace — preset slug */}
      <div
        style={{
          position: 'absolute',
          top: 56,
          right: 14,
          fontFamily: JDM.fontMono,
          fontSize: 9,
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        cover · {preset.slug}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Parking-stall card — the new spot card. Architectural / blueprint
// treatment: painted stall outline, monospace slot number, source
// tinted paint. Filled variant renders the car photo "parked" inside.
// ─────────────────────────────────────────────────────────────

function StallFloor({ paintColor = JDM.paintFree, slotNumber = '01', source, dim = false }) {
  // Painted lines on the floor + slot number plate
  return (
    <>
      {/* asphalt base */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: JDM.asphalt,
          backgroundImage:
            `repeating-linear-gradient(0deg, ${JDM.asphaltLine} 0 1px, transparent 1px 4px),` +
            `repeating-linear-gradient(90deg, ${JDM.asphaltLine} 0 1px, transparent 1px 4px)`,
          opacity: dim ? 0.4 : 1,
        }}
      />
      {/* painted U lines — left/right rails + bottom curb */}
      <div
        style={{
          position: 'absolute',
          left: 10,
          top: 10,
          bottom: 10,
          width: 3,
          background: paintColor,
          borderRadius: 2,
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 10,
          top: 10,
          bottom: 10,
          width: 3,
          background: paintColor,
          borderRadius: 2,
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 10,
          right: 10,
          bottom: 10,
          height: 3,
          background: paintColor,
          borderRadius: 2,
          opacity: 0.85,
        }}
      />
      {/* faint chevron at top — entry hint */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <div
          style={{
            width: 18,
            height: 2,
            background: paintColor,
            opacity: 0.45,
            transform: 'skewX(-30deg)',
          }}
        />
        <div
          style={{
            width: 18,
            height: 2,
            background: paintColor,
            opacity: 0.45,
            transform: 'skewX(-30deg)',
          }}
        />
      </div>
      {/* slot number plate (top-left corner inside the stall) */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            fontFamily: JDM.fontMono,
            fontSize: 11,
            color: paintColor,
            fontWeight: 600,
            letterSpacing: 1,
          }}
        >
          SLOT {String(slotNumber).padStart(2, '0')}
        </span>
      </div>
      {/* source tape — top-right corner */}
      {source && source !== 'default_free' ? (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 3,
            background: source === 'purchase' ? 'rgba(232,179,57,0.18)' : 'rgba(74,212,224,0.18)',
            color: source === 'purchase' ? JDM.paintExtra : JDM.paintAdmin,
            border: `1px dashed ${source === 'purchase' ? JDM.paintExtra : JDM.paintAdmin}`,
            fontFamily: JDM.fontMono,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}
        >
          {source === 'purchase' ? 'Reservada' : 'Cortesia'}
        </div>
      ) : null}
    </>
  );
}

// Filled stall — car photo parked inside the painted lines.
function FilledStallCard({
  car,
  slotNumber,
  source,
  premiumActive,
  premiumTier,
  badgeVariant,
  onPress,
  onBadgePress,
}) {
  const paint =
    source === 'purchase'
      ? JDM.paintExtra
      : source === 'admin_grant'
        ? JDM.paintAdmin
        : JDM.paintFree;
  return (
    <button
      onClick={onPress}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: JDM.surface,
        border: `1px solid ${JDM.border}`,
        minHeight: 116,
      }}
    >
      <div style={{ position: 'relative', height: 116 }}>
        <StallFloor paintColor={paint} slotNumber={slotNumber} source={source} />
        {/* car photo, parked inside stall — occupies most of the floor */}
        <div
          style={{
            position: 'absolute',
            left: 22,
            right: 22,
            top: 36,
            bottom: 18,
            borderRadius: 10,
            overflow: 'hidden',
            background: car.tone,
            boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                `radial-gradient(60% 50% at 50% 70%, ${car.accent}55, transparent 60%),` +
                `repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 6px, transparent 6px 14px)`,
            }}
          />
          {/* headlights row */}
          <div
            style={{
              position: 'absolute',
              left: '18%',
              right: '18%',
              bottom: '30%',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                width: 14,
                height: 5,
                borderRadius: 3,
                background: car.accent,
                boxShadow: `0 0 14px ${car.accent}`,
              }}
            />
            <div
              style={{
                width: 14,
                height: 5,
                borderRadius: 3,
                background: car.accent,
                boxShadow: `0 0 14px ${car.accent}`,
              }}
            />
          </div>
        </div>
      </div>
      {/* metadata band */}
      <div
        style={{
          padding: '10px 14px 12px',
          background: JDM.surfaceDeep,
          borderTop: `1px solid ${JDM.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 14,
              color: JDM.text,
              letterSpacing: -0.1,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {car.year} {car.make} {car.model}
          </div>
          {premiumActive ? (
            <PremiumBadge
              variant={badgeVariant}
              tier={premiumTier}
              size="sm"
              onPress={onBadgePress}
            />
          ) : null}
        </div>
        <div
          style={{
            fontFamily: JDM.fontSans,
            fontSize: 12,
            color: JDM.textMut,
          }}
        >
          {car.nickname}
        </div>
      </div>
    </button>
  );
}

// Empty stall — painted outline + slot number + CTA copy.
function EmptyStallCard({ slotNumber, source, onPress }) {
  const paint =
    source === 'purchase'
      ? JDM.paintExtra
      : source === 'admin_grant'
        ? JDM.paintAdmin
        : JDM.paintFree;
  const isFree = source === 'default_free';
  const title = 'Adicionar Carro';
  const subtitle = isFree
    ? 'Use uma das suas vagas grátis'
    : source === 'purchase'
      ? 'Vaga extra disponível'
      : 'Vaga concedida disponível';
  return (
    <button
      onClick={onPress}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: JDM.surface,
        border: `1px solid ${JDM.border}`,
        minHeight: 116,
      }}
    >
      <div style={{ position: 'relative', height: 116 }}>
        <StallFloor paintColor={paint} slotNumber={slotNumber} source={source} dim={false} />
        {/* center CTA inside the painted stall */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              border: `1.5px dashed ${paint}`,
              background: 'rgba(255,255,255,0.02)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: paint,
            }}
          >
            <Icon.Plus s={20} />
          </div>
        </div>
      </div>
      <div
        style={{
          padding: '10px 14px 12px',
          background: JDM.surfaceDeep,
          borderTop: `1px solid ${JDM.border}`,
        }}
      >
        <div
          style={{
            fontFamily: JDM.fontSans,
            fontWeight: 600,
            fontSize: 14,
            color: JDM.text,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: JDM.fontSans,
            fontSize: 12,
            color: JDM.textMut,
          }}
        >
          {subtitle}
        </div>
      </div>
    </button>
  );
}

// Buy-spot stall — different paint (brand red) + price.
function BuySpotStallCard({ slotNumber, priceLabel, onPress }) {
  return (
    <button
      onClick={onPress}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: JDM.surface,
        border: `1px solid rgba(225,6,0,0.4)`,
        minHeight: 116,
      }}
    >
      <div style={{ position: 'relative', height: 116 }}>
        <StallFloor paintColor={JDM.brandSoft} slotNumber={slotNumber} source="buy" />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              border: `1.5px solid ${JDM.brand}`,
              background: JDM.brandTint,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: JDM.brandSoft,
              boxShadow: `0 0 18px rgba(225,6,0,0.35)`,
            }}
          >
            <Icon.Plus s={20} />
          </div>
        </div>
        {/* "AVAILABLE" tape — top right replaced by price tag */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 3,
            background: JDM.brandTint,
            color: JDM.brandSoft,
            border: `1px solid rgba(225,6,0,0.45)`,
            fontFamily: JDM.fontMono,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}
        >
          À venda
        </div>
      </div>
      <div
        style={{
          padding: '10px 14px 12px',
          background: JDM.surfaceDeep,
          borderTop: `1px solid ${JDM.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontWeight: 700,
              fontSize: 14,
              color: JDM.text,
            }}
          >
            Comprar Vaga Adicional
          </div>
          <div
            style={{
              fontFamily: JDM.fontSans,
              fontSize: 12,
              color: JDM.textMut,
            }}
          >
            Vaga extra para outro carro
          </div>
        </div>
        <div
          style={{
            fontFamily: JDM.fontMono,
            fontWeight: 700,
            fontSize: 15,
            color: JDM.text,
          }}
        >
          {priceLabel}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// iOS status bar — used inside the IOSFrame children
// ─────────────────────────────────────────────────────────────

function StatusBar({ light = true }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        color: light ? '#fff' : '#000',
        fontFamily: JDM.fontSans,
        fontWeight: 600,
        fontSize: 14,
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      <span style={{ marginTop: 8 }}>9:41</span>
      <span style={{ marginTop: 8, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
          <rect x="0" y="6" width="2.5" height="5" rx="0.5" />
          <rect x="4" y="4" width="2.5" height="7" rx="0.5" />
          <rect x="8" y="2" width="2.5" height="9" rx="0.5" />
          <rect x="12" y="0" width="2.5" height="11" rx="0.5" />
        </svg>
        <svg
          width="20"
          height="11"
          viewBox="0 0 20 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <rect x="0.5" y="0.5" width="16" height="10" rx="2" />
          <rect x="17.5" y="3.5" width="1.5" height="4" rx="0.5" fill="currentColor" />
          <rect x="2" y="2" width="13" height="7" rx="1" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

Object.assign(window, {
  JDM,
  SAMPLE_CARS,
  SAMPLE_GARAGE,
  COVER_PRESETS,
  Icon,
  Pill,
  tierColors,
  PremiumBadge,
  PremiumBadgeV1,
  PremiumBadgeV2,
  PremiumBadgeV3,
  GarageCover,
  StallFloor,
  FilledStallCard,
  EmptyStallCard,
  BuySpotStallCard,
  StatusBar,
});
