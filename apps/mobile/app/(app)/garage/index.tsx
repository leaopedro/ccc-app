import type { GarageBadgesOwnerResponse } from '@jdm/shared/badges';
import { BadgeRow, BadgesSheet, PremiumSheet, ProfileStats, type BadgesSheetCopy } from '@jdm/ui';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getGarage, getMyBadges, togglePinBadge, type GarageReadResponse } from '~/api/garage';
import { badgesCopy } from '~/copy/badges';
import { garageCopy } from '~/copy/garage';
import { BuySpotSheet } from '~/screens/garage/BuySpotSheet';
import { ExpiredPremiumNotice } from '~/screens/garage/ExpiredPremiumNotice';
import { GarageHeader } from '~/screens/garage/GarageHeader';
import { GarageListView } from '~/screens/garage/GarageListView';
import { VagasSectionHeader } from '~/screens/garage/VagasSectionHeader';
import { WelcomeBanner } from '~/screens/garage/WelcomeBanner';
import {
  hasExtraSpots,
  showExpiredPremiumNotice,
  showWelcomeBanner,
} from '~/screens/garage/garage-header-gates';
import { pickProfileStatsProps } from '~/screens/garage/garage-progression.viewmodel';
import { buildGarageSlots } from '~/screens/garage/garage-slots';
import { useBuySpotFlow } from '~/screens/garage/useBuySpotFlow';
import { theme } from '~/theme';

// Chunk 19 — PT-BR copy mapped to the BadgesSheet `copy` prop shape.
// Source: `apps/mobile/src/copy/badges.ts` (PT-BR primary). Missing entries
// fall back to the bare badge code in BadgeDetail.
const BADGE_COPY: Record<string, BadgesSheetCopy | undefined> = Object.fromEntries(
  Object.entries(badgesCopy.badges.catalog).map(([code, entry]) => [
    code,
    { title: entry.title, description: entry.description },
  ]),
);

// Chunk 19 — BadgeRow visibility: hidden when (a) gamification killswitch is
// off OR (b) the user has zero earned badges AND is still a fresh signup
// (no cars, no premium). Avoids the empty-teaser on day-1 users; otherwise
// shows up to 4 tiles + "+N" chip even when the only entries are locked.
const shouldShowBadgeRow = (data: GarageReadResponse): boolean => {
  if (!data.garage.gamification.enabled) return false;
  const earnedCount = data.garage.badges.filter((b) => b.state === 'earned').length;
  if (earnedCount === 0 && showWelcomeBanner(data)) return false;
  return true;
};

export default function GarageIndex() {
  const router = useRouter();
  const params = useLocalSearchParams<{ highlight?: string }>();
  const [garage, setGarage] = useState<GarageReadResponse | null>(null);
  const [highlightSpotId, setHighlightSpotId] = useState<string | null>(null);
  const [badgesSheetOpen, setBadgesSheetOpen] = useState(false);
  const [badgesUpsellOpen, setBadgesUpsellOpen] = useState(false);
  const { buySheet, submitting, openBuySheet, closeBuySheet, goCheckout } = useBuySpotFlow();

  // Chunk 19 polish — fold the badges fetch into the same useFocusEffect as
  // getGarage so a mid-session killswitch flip cannot race the second
  // useEffect's dependency comparison.
  const [badgesAggregate, setBadgesAggregate] = useState<GarageBadgesOwnerResponse | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Cancellation guard: rapid focus-blur-focus (or admin killswitch
      // flip mid-flight) can leave a slow earlier getMyBadges() racing a
      // newer focus that already decided gamification.enabled=false. If
      // the stale response lands first, badges would render despite the
      // killswitch being off. The closure-captured flag drops late
      // writes; the latest focus always wins.
      let cancelled = false;
      void (async () => {
        const next = await getGarage();
        if (cancelled) return;
        setGarage(next);
        if (next.garage.gamification.enabled) {
          try {
            const aggregate = await getMyBadges();
            if (cancelled) return;
            setBadgesAggregate(aggregate);
          } catch {
            if (cancelled) return;
            setBadgesAggregate(null);
          }
        } else {
          setBadgesAggregate(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleLockedBadgePress = useCallback(() => {
    // Close the catalog sheet first so the upsell sheet animates in cleanly
    // even when the user tapped a locked tile from inside BadgesSheet.
    setBadgesSheetOpen(false);
    setBadgesUpsellOpen(true);
  }, []);

  const handleOpenBadgesSheet = useCallback(() => {
    if (!garage?.garage.gamification.enabled) return;
    setBadgesSheetOpen(true);
  }, [garage]);

  // §10.3 — surface the post-purchase pulse via the `?highlight=<spotId>`
  // URL param. Strip the param immediately so a remount/reload/copied-URL
  // visit can't re-pulse forever; auto-clear local state after 2s.
  useEffect(() => {
    if (typeof params.highlight === 'string' && params.highlight.length > 0) {
      const spotId = params.highlight;
      setHighlightSpotId(spotId);
      router.setParams({ highlight: '' });
      const t = setTimeout(() => setHighlightSpotId(null), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [params.highlight, router]);

  const slots = useMemo(() => (garage ? buildGarageSlots(garage) : []), [garage]);

  // Chunk 19 — BadgeRow + BadgesSheet need the catalog (icon/rarity/category
  // per code) which is NOT spread onto GarageOwner.badges — that field carries
  // owner-state rows only. The owner aggregate (`enabled + catalog + badges`)
  // is fetched inside the consolidated useFocusEffect above. The garage
  // payload's inline `badges` field is unused for badge rendering on this
  // surface.
  const gamificationEnabled = garage?.garage.gamification.enabled ?? false;

  const refetchBadges = useCallback(async () => {
    if (!gamificationEnabled) return;
    try {
      setBadgesAggregate(await getMyBadges());
    } catch {
      /* swallow — pin already committed server-side; will reconcile next focus */
    }
  }, [gamificationEnabled]);

  const handleTogglePin = useCallback(
    (code: string) => {
      const current = badgesAggregate?.badges.find((b) => b.code === code);
      if (!current || current.state !== 'earned') return;
      const nextPinned = !current.pinned;
      void (async () => {
        try {
          await togglePinBadge(code, nextPinned);
        } finally {
          // Always refetch — pin_limit / killswitch errors should surface real state.
          await refetchBadges();
        }
      })();
    },
    [badgesAggregate, refetchBadges],
  );

  const pinCount = useMemo(() => {
    if (!badgesAggregate) return 0;
    return badgesAggregate.badges.filter((b) => b.state === 'earned' && b.pinned).length;
  }, [badgesAggregate]);

  const handleAddCar = useCallback(() => {
    router.push('/garage/new' as never);
  }, [router]);

  if (!garage) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const renderBadgeRow = shouldShowBadgeRow(garage) && badgesAggregate !== null;
  // Chunk 40 — derive <ProfileStats /> props from the in-flight payload.
  // Returns null when the killswitch is off or progress/stats are absent
  // (§C10 .optional()). No new effect — the existing useFocusEffect above
  // refetches getGarage() on focus, which propagates a fresh top-level
  // gamification.enabled flag through render.
  const profileStatsProps = pickProfileStatsProps(garage);

  return (
    <View style={styles.container}>
      <GarageListView
        slots={slots}
        premiumTier={garage.garage.premiumTier}
        daysLeftUntilExpiry={garage.garage.daysLeftUntilExpiry}
        highlightSpotId={highlightSpotId}
        onBuySpot={() => openBuySheet(garage)}
        onAddCar={handleAddCar}
        onFilledCarPress={(carId) => router.push(`/garage/${carId}` as never)}
        onBadgePress={() => undefined /* wired in chunk 08 */}
        ListHeaderComponent={
          <View style={styles.header}>
            <GarageHeader
              garage={garage.garage}
              carCount={garage.cars.length}
              onUpdated={(next) => setGarage((prev) => (prev ? { ...prev, garage: next } : prev))}
            />
            {showWelcomeBanner(garage) ? <WelcomeBanner freeLimit={garage.freeLimit} /> : null}
            {showExpiredPremiumNotice(garage) ? <ExpiredPremiumNotice /> : null}
            {profileStatsProps ? (
              <ProfileStats
                progress={profileStatsProps.progress}
                stats={profileStatsProps.stats}
                gamificationEnabled={profileStatsProps.gamificationEnabled}
                isFreshSignup={profileStatsProps.isFreshSignup}
                viewMode={profileStatsProps.viewMode}
                testID="garage-profile-stats"
              />
            ) : null}
            {renderBadgeRow && badgesAggregate ? (
              <BadgeRow
                data={badgesAggregate}
                onOpenSheet={handleOpenBadgesSheet}
                onLockedPress={handleLockedBadgePress}
                testID="garage-badge-row"
              />
            ) : null}
            <VagasSectionHeader
              carCount={garage.cars.length}
              freeLimit={garage.freeLimit}
              isUnlimited={garage.isUnlimited}
              hasExtra={hasExtraSpots(garage)}
            />
          </View>
        }
      />
      <BuySpotSheet
        visible={buySheet !== null}
        priceLabel={buySheet?.priceLabel ?? ''}
        submitting={submitting}
        onClose={closeBuySheet}
        onCheckoutPix={() => {
          void goCheckout();
        }}
        onCheckoutCard={() => {
          void goCheckout();
        }}
      />
      {badgesAggregate ? (
        <BadgesSheet
          visible={badgesSheetOpen}
          onClose={() => setBadgesSheetOpen(false)}
          data={badgesAggregate}
          onLockedPress={handleLockedBadgePress}
          onTogglePin={handleTogglePin}
          pinCount={pinCount}
          pinCap={3}
          copy={BADGE_COPY}
          testID="garage-badges-sheet"
        />
      ) : null}
      <PremiumSheet
        visible={badgesUpsellOpen}
        tier={garage.garage.premiumTier}
        isPremiumActive={garage.garage.isPremiumActive}
        daysLeftUntilExpiry={garage.garage.daysLeftUntilExpiry}
        onClose={() => setBadgesUpsellOpen(false)}
        copy={{
          title: garageCopy.garage.premiumSheetTitle,
          tierLabel: garageCopy.garage.premiumTierLabel(garage.garage.premiumTier ?? 'gold'),
          heroTitle: garageCopy.garage.premiumHeroTitle,
          heroBody: garageCopy.garage.premiumHeroBody,
          nearExpiry: garageCopy.garage.premiumNearExpiry,
          benefits: garageCopy.garage.premiumBenefits,
          footer: garageCopy.garage.premiumFooter,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  header: { paddingBottom: theme.spacing.md },
});
