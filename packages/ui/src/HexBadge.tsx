import { Pressable, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { BadgeGlyph } from './BadgeGlyph.js';
import { garageTokens, rarityColors, type GarageRarity } from './garage-tokens.js';

export type HexBadgeVariant = 'earned' | 'locked' | 'locked_premium';
export type HexBadgeSize = 'sm' | 'md' | 'lg';

export interface HexBadgeProps {
  /** Badge code (e.g. `EVT-001`) — used for accessibility + testID. */
  code: string;
  /** Visual state. Locked + locked_premium render grayscale + Lock glyph. */
  variant: HexBadgeVariant;
  /** Drives the hex ring colour + tint. */
  rarity: GarageRarity;
  /** Catalog `icon` wire string — resolved by `BadgeGlyph`. */
  icon: string;
  /** Outer hex diameter: sm=32, md=52, lg=96. */
  size: HexBadgeSize;
  /** Optional tap handler — wraps in a Pressable when provided. */
  onPress?: () => void;
  /** Optional human-readable label rendered under the hex (sheet grid uses this). */
  label?: string;
  /** Used by tests + dispatch tracking. */
  testID?: string;
}

const SIZES: Record<HexBadgeSize, { outer: number; glyph: number; tagFontSize: number }> = {
  sm: { outer: 32, glyph: 14, tagFontSize: 8 },
  md: { outer: 52, glyph: 22, tagFontSize: 9 },
  lg: { outer: 96, glyph: 38, tagFontSize: 10 },
};

const RING_WIDTH: Record<HexBadgeSize, number> = { sm: 1.25, md: 1.5, lg: 2 };

// Flat-top hex polygon vertices for a 100×100 viewBox. Mirrors the
// `polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)` clip-path
// used by the web canon (`.handoffs/.../jdma-garage/badges.jsx` line 401)
// since RN has no CSS `clip-path`.
const HEX_OUTER = '25,5 75,5 100,50 75,95 25,95 0,50';

// Inner hex sits 6% inside the outer to expose the ring. The exact inset is
// tuned to match the web `inset: ringW` look at md size — the ratio renders
// visually identical across sm/md/lg.
const HEX_INNER = '28,9 72,9 96,50 72,91 28,91 4,50';

/**
 * HexBadge — the canonical visual primitive for the Conquistas system. A
 * flat-top hexagon with a rarity-tinted ring + central glyph + optional
 * "Exclusivo Premium" tag for locked-premium badges.
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` HexBadge (lines
 * 393–547). RN port substitutes `react-native-svg` `Polygon` for the web
 * `clip-path` hex shape and `BadgeGlyph` (Lucide-RN) for the inline SVG
 * glyphs. Sizes mirror the canon (sm=32, md=52, lg=96).
 *
 * Locked + locked_premium variants render the `Lock` glyph + dimmed
 * (`opacity: 0.45`) outer surface — never `disabled`. Per §C11 precedent,
 * the caller wires the upsell via `onPress` on the parent (`BadgeRow` /
 * `BadgesSheet`); this primitive only exposes the press surface.
 */
export function HexBadge({
  code,
  variant,
  rarity,
  icon,
  size,
  onPress,
  label,
  testID,
}: HexBadgeProps) {
  const r = rarityColors(rarity);
  const dim = SIZES[size].outer;
  const glyphSize = SIZES[size].glyph;
  const tagFs = SIZES[size].tagFontSize;
  const ringW = RING_WIDTH[size];
  const isEarned = variant === 'earned';
  const isPremiumLocked = variant === 'locked_premium';
  const ringColor = isEarned ? r.main : garageTokens.surface.borderStrong;
  const fillColor = isEarned ? garageTokens.surface.sheet : garageTokens.surface.alt;
  const glyphColor = isEarned ? r.main : '#8A8A93';
  const glyphName = isEarned ? icon : 'lock';

  const a11yLabel = `Conquista ${code}, ${isEarned ? 'desbloqueada' : 'bloqueada'}`;

  const hex = (
    <View
      style={{
        width: dim,
        height: dim,
        position: 'relative',
        opacity: isEarned ? 1 : 0.45,
      }}
    >
      <Svg width={dim} height={dim} viewBox="0 0 100 100">
        {/* Outer ring */}
        <Polygon
          points={HEX_OUTER}
          fill={ringColor}
          stroke={ringColor}
          strokeWidth={ringW * 2}
          strokeLinejoin="round"
        />
        {/* Inner fill */}
        <Polygon points={HEX_INNER} fill={fillColor} />
      </Svg>
      {/* Glyph (centered absolutely over the hex) */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        <BadgeGlyph name={glyphName} size={glyphSize} color={glyphColor} />
      </View>
      {isEarned && rarity === 'legendary' && size !== 'sm' ? (
        <View
          testID="hex-legendary-dot"
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: size === 'lg' ? 14 : 4,
            right: size === 'lg' ? 14 : 4,
            width: size === 'lg' ? 12 : 8,
            height: size === 'lg' ? 12 : 8,
            borderRadius: 999,
            backgroundColor: r.main,
          }}
        />
      ) : null}
    </View>
  );

  const labelEl = label ? (
    <Text
      style={{
        marginTop: 6,
        textAlign: 'center',
        color: isEarned ? '#F5F5F5' : '#8A8A93',
        fontSize: 11,
        fontWeight: '700',
        maxWidth: dim + 28,
        lineHeight: 14,
      }}
      numberOfLines={2}
    >
      {label}
    </Text>
  ) : null;

  // Locked-premium tag — small pill rendered just below the hex.
  const premiumTag = isPremiumLocked ? (
    <View
      style={{
        marginTop: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: garageTokens.tier.goldTint,
        borderWidth: 1,
        borderColor: `${garageTokens.tier.gold}66`,
      }}
    >
      <Text
        style={{
          color: garageTokens.tier.gold,
          fontSize: tagFs,
          fontWeight: '700',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        Exclusivo Premium
      </Text>
    </View>
  ) : null;

  const content = (
    <View style={{ alignItems: 'center' }}>
      {hex}
      {labelEl}
      {premiumTag}
    </View>
  );

  if (!onPress) {
    return (
      <View accessibilityLabel={a11yLabel} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  );
}
