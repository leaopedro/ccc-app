import { brand } from '@jdm/design';
import type { GarageProgress } from '@jdm/shared/garage-progress';
import { useId } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';

import { garageTokens } from './garage-tokens.js';

export interface XPScoreboardProps {
  /** Server-derived progress (chunk 24). MUST be non-null — wrapper short-circuits when missing. */
  progress: GarageProgress;
  /**
   * Tap handler for the `?` button. OPTIONAL (canon §12).
   * - Mobile composition (chunk 39 ProfileStats) passes the tooltip opener.
   * - SSR composition (chunk 41 ProfileStatsWeb) passes undefined so the `?` renders
   *   static + non-interactive (no Pressable on mobile, no <button> on web).
   */
  onPressHint?: () => void;
  /** Used by tests + dispatch tracking. */
  testID?: string;
}

// 11 evenly-spaced ticker positions across the bar. i % 5 === 0 → tall hatch.
const TICKS = Array.from({ length: 11 }, (_, i) => i);

/**
 * XPScoreboard — the chamativo XP card for the garage profile. Mobile RN
 * twin. Renders:
 * - Anton 46px XP number with brand-tinted textShadow glow.
 * - Rank pill (right-aligned, brand-tinted background + brand border).
 * - `?` hint button. OPTIONAL handler per canon §12: when defined renders a
 *   Pressable; when undefined renders a static non-interactive element so
 *   the SSR composition (chunk 41) can render the same prop shape.
 * - 8px brand-gradient progress bar with 11 mono ticker hatches (every 5th
 *   tall).
 * - Caption row (rank label left, `${xpToNext} → ${nextRank}` right or
 *   "Topo do ranking" at top tier).
 *
 * Top-tier sentinel per outline §C14: when `nextRank === null` the
 * derivation emits `tierSpan = 1` + `xpToNextRank = 0`. We branch on
 * `nextRank === null` BEFORE the division so the bar forces to 100% and the
 * caption swaps to "Topo do ranking". Mirrors canon `progress.jsx:263–265`.
 *
 * Animation deferred to Phase 2D (skeleton open-Q #1 default = hard-set on
 * read; no tween / glow pulse in v1).
 *
 * Outline §308 caveat: `textShadowColor` + `textShadowRadius` + zero
 * `textShadowOffset` approximate the web `text-shadow: 0 0 24px ...` blur;
 * pixel-perfect glow may need tuning during device QA. Test asserts the
 * keys; numeric radius is tunable.
 *
 * Pure presentational primitive — owns NO state. Tooltip open/close lives
 * in chunk 39's `ProfileStats` wrapper.
 */
export function XPScoreboard({ progress, onPressHint, testID }: XPScoreboardProps) {
  // Unique gradient ids per instance so multiple scoreboards on screen never
  // collide on `url(#...)` references.
  const uid = useId();
  const gradTintId = `xp-scoreboard-tint-${uid}`;
  const gradStripeId = `xp-scoreboard-stripe-${uid}`;
  const gradProgressId = `xp-scoreboard-progress-${uid}`;

  const isTopTier = progress.nextRank === null;
  // §C14 — force 100% BEFORE the division so the tierSpan=1 sentinel does
  // not divide xpInTier by 1 and overshoot. Mirrors canon progress.jsx:263.
  const pct = isTopTier
    ? 100
    : Math.max(0, Math.min(100, Math.round((progress.xpInTier / progress.tierSpan) * 100)));
  const caption = isTopTier
    ? 'Topo do ranking'
    : `${progress.xpToNextRank.toLocaleString('pt-BR')} → ${progress.nextRank ?? ''}`;

  const xpFormatted = progress.xp.toLocaleString('pt-BR');

  const hintCommon = {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: garageTokens.surface.alt,
    borderWidth: 1,
    borderColor: garageTokens.surface.border,
  };
  const hintGlyph = (
    <Text
      style={{
        fontFamily: 'Inter_700Bold',
        fontWeight: '700',
        fontSize: 11,
        color: '#C8C8CE',
        lineHeight: 14,
      }}
    >
      ?
    </Text>
  );

  const hintEl =
    typeof onPressHint === 'function' ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Como ganhar XP"
        onPress={onPressHint}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID={testID ? `${testID}-hint` : 'xp-scoreboard-hint'}
        style={hintCommon}
      >
        {hintGlyph}
      </Pressable>
    ) : (
      // Static fallback is decorative: no handler, no interactive role.
      // Hide from RN's accessibility tree so screen readers do not announce
      // a bare "?" with no associated action. The web twin mirrors this with
      // `aria-hidden="true"`.
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={hintCommon}
      >
        {hintGlyph}
      </View>
    );

  return (
    <View
      testID={testID}
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: garageTokens.surface.sheet,
        borderWidth: 1,
        borderColor: garageTokens.surface.border,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 14,
      }}
    >
      {/* 135° brand-tint glow over the card surface. SVG instead of
        expo-linear-gradient so `@jdm/ui` has no extra runtime dep — see
        canon §15. */}
      <Svg
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <Defs>
          <SvgLinearGradient id={gradTintId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={garageTokens.brand.tint} />
            <Stop offset="0.6" stopColor={garageTokens.brand.tint} stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradTintId})`} />
      </Svg>

      {/* Top-right 64×4 racing-stripe accent. */}
      <Svg
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, right: 0, width: 64, height: 4 }}
      >
        <Defs>
          <SvgLinearGradient id={gradStripeId} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={garageTokens.brand.base} stopOpacity="0" />
            <Stop offset="1" stopColor={garageTokens.brand.base} />
          </SvgLinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradStripeId})`} />
      </Svg>

      {/* Row 1 — XP label + ? button (left), rank pill (right). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 10,
              color: '#8A8A93',
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              marginRight: 6,
            }}
          >
            XP
          </Text>
          {hintEl}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 9,
            paddingVertical: 3,
            borderRadius: 4,
            backgroundColor: garageTokens.brand.tint,
            borderWidth: 1,
            borderColor: 'rgba(212,175,55,0.45)',
          }}
        >
          <Text
            style={{
              fontFamily: 'Inter_700Bold',
              fontWeight: '700',
              fontSize: 10,
              color: garageTokens.brand.soft,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
            }}
          >
            {progress.rank}
          </Text>
        </View>
      </View>

      {/* Row 2 — BIG Anton XP number + "pontos" caption. */}
      <View
        style={{
          marginTop: 6,
          flexDirection: 'row',
          alignItems: 'baseline',
        }}
      >
        <Text
          accessibilityLabel={`${xpFormatted} XP`}
          style={{
            fontFamily: brand.typography.displayFontNative,
            fontSize: 46,
            lineHeight: 46,
            color: '#F5F5F5',
            letterSpacing: -1.5,
            textShadowColor: 'rgba(212,175,55,0.18)',
            textShadowRadius: 24,
            textShadowOffset: { width: 0, height: 0 },
          }}
        >
          {xpFormatted}
        </Text>
        <Text
          style={{
            marginLeft: 10,
            fontFamily: 'JetBrainsMono_400Regular',
            fontSize: 11,
            color: '#8A8A93',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          pontos
        </Text>
      </View>

      {/* Row 3 — progress bar with mono ticker hatches. */}
      <View style={{ marginTop: 12 }}>
        <View
          style={{
            position: 'relative',
            height: 8,
            borderRadius: 4,
            backgroundColor: garageTokens.surface.deep,
            borderWidth: 1,
            borderColor: garageTokens.surface.border,
            overflow: 'hidden',
          }}
        >
          <Svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
            }}
          >
            <Defs>
              <SvgLinearGradient id={gradProgressId} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={garageTokens.brand.deep} />
                <Stop offset="1" stopColor={garageTokens.brand.base} />
              </SvgLinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradProgressId})`} />
          </Svg>
          {/* ticker hatches — overlay full bar. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 2,
            }}
          >
            {TICKS.map((i) => (
              <View
                key={i}
                style={{
                  width: 1,
                  height: i % 5 === 0 ? 8 : 4,
                  borderRadius: 1,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                }}
              />
            ))}
          </View>
        </View>
        {/* Caption row */}
        <View
          style={{
            marginTop: 6,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 10,
              color: '#8A8A93',
              letterSpacing: 0.4,
            }}
          >
            {progress.rank}
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 10,
              color: '#C8C8CE',
              letterSpacing: 0.4,
            }}
          >
            {caption}
          </Text>
        </View>
      </View>
    </View>
  );
}
