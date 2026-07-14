import type { GarageBadgesOwnerResponse, GarageBadgeOwnerState } from '@ccc/shared/badges';
import { Pressable, Text, View } from 'react-native';

import { HexBadge } from './HexBadge.js';
import { garageTokens } from './garage-tokens.js';

const MAX_FEATURED = 4;

export interface BadgeRowProps {
  /** Owner shape from `GET /me/garage/badges`. */
  data: GarageBadgesOwnerResponse;
  /** Tap on an earned tile OR the "Ver todas" / "+N" chip. */
  onOpenSheet: () => void;
  /** Tap on a locked OR locked_premium tile — chunk 19 wires the upsell. */
  onLockedPress: (code: string) => void;
  /** Optional override — set to `false` to short-circuit render in chunk 19
   *  when the gamification killswitch is off OR signup is too fresh. Chunk 17
   *  just exposes the prop; chunk 19 supplies the fresh-signup check. */
  visible?: boolean;
  testID?: string;
}

type EarnedBadge = {
  code: string;
  state: 'earned';
  earnedAt: string;
  pinned: boolean;
  pinnedAt: string | null;
};

const isEarned = (
  b: GarageBadgeOwnerState,
): b is EarnedBadge => b.state === 'earned';

const badgeTimestamp = (badge: EarnedBadge): string => badge.pinnedAt ?? badge.earnedAt;

/**
 * Order: pinned-first (pinnedAt DESC), then unpinned earned (earnedAt DESC),
 * then locked + locked_premium in catalog order. Mirrors the spec from the
 * chunk 17 brief.
 */
function orderBadges(
  badges: GarageBadgeOwnerState[],
  catalog: GarageBadgesOwnerResponse['catalog'],
): GarageBadgeOwnerState[] {
  const earned: EarnedBadge[] = badges.filter(isEarned);
  const pinned: EarnedBadge[] = earned
    .filter((b) => b.pinned)
    .sort((a, b) => {
      return badgeTimestamp(b).localeCompare(badgeTimestamp(a));
    });
  const unpinned: EarnedBadge[] = earned
    .filter((b) => !b.pinned)
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
  const earnedCodes = new Set(earned.map((b) => b.code));
  const lockedInCatalogOrder: GarageBadgeOwnerState[] = [];
  for (const entry of catalog) {
    if (earnedCodes.has(entry.code)) continue;
    const match = badges.find((b) => b.code === entry.code);
    if (match) lockedInCatalogOrder.push(match);
  }
  return [...pinned, ...unpinned, ...lockedInCatalogOrder];
}

/**
 * BadgeRow — horizontal "Conquistas" strip on the owner garage screen. Shows
 * up to 4 hex badges (md size) followed by a "+N" overflow chip that opens
 * `BadgesSheet`. Locked tiles fire `onLockedPress(code)` so chunk 19 can wire
 * the upsell sheet without changing this primitive (§C11 precedent).
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` BadgeRow (lines
 * 554–667). The RN port collapses the per-mode (owner vs public) ordering
 * down to a single owner-shape ordering since chunk 17 only ships the owner
 * surface — the public twin is chunk 21.
 */
export function BadgeRow({ data, onOpenSheet, onLockedPress, visible, testID }: BadgeRowProps) {
  const enabled = data.enabled && visible !== false;
  if (!enabled) return null;

  const ordered = orderBadges(data.badges, data.catalog);
  const featured = ordered.slice(0, MAX_FEATURED);
  const overflow = Math.max(0, ordered.length - MAX_FEATURED);
  const earnedCount = data.badges.filter(isEarned).length;
  const totalCatalog = data.catalog.length;

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        padding: 12,
        backgroundColor: garageTokens.surface.sheet,
        borderWidth: 1,
        borderColor: garageTokens.surface.border,
        borderRadius: 14,
      }}
      testID={testID}
    >
      {/* Header row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ color: '#F5F5F5', fontSize: 13, fontWeight: '700' }}>Conquistas</Text>
          <Text style={{ color: '#8A8A93', fontSize: 11, fontVariant: ['tabular-nums'] }}>
            {earnedCount}/{totalCatalog}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ver todas as conquistas"
          onPress={onOpenSheet}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ color: garageTokens.brand.soft, fontSize: 12, fontWeight: '600' }}>
            Ver todas
          </Text>
        </Pressable>
      </View>

      {/* Tiles */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        {featured.map((b) => {
          const entry = data.catalog.find((c) => c.code === b.code);
          if (!entry) return null;
          const variant = b.state;
          const onPress = variant === 'earned' ? onOpenSheet : () => onLockedPress(b.code);
          return (
            <HexBadge
              key={b.code}
              code={b.code}
              variant={variant}
              rarity={entry.rarity}
              icon={entry.icon}
              size="md"
              onPress={onPress}
            />
          );
        })}
        {overflow > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver mais ${overflow} conquistas`}
            onPress={onOpenSheet}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              width: 52,
              height: 52,
              borderRadius: 8,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: garageTokens.surface.border,
              backgroundColor: garageTokens.surface.deep,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Text style={{ color: '#C9C9CD', fontSize: 13, fontWeight: '700' }}>+{overflow}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
