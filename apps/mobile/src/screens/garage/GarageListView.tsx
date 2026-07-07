import { type GaragePremiumTier, ParkingStallCard, type ParkingStallCarPayload } from '@jdm/ui';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import type { GarageSlotV2 } from './garage-slots';

import { theme } from '~/theme';

type Props = {
  slots: GarageSlotV2[];
  premiumTier: GaragePremiumTier | null;
  daysLeftUntilExpiry: number | null;
  highlightSpotId?: string | null;
  onBadgePress: () => void;
  onBuySpot: () => void;
  onAddCar: () => void;
  onFilledCarPress: (carId: string) => void;
  ListHeaderComponent?: ReactElement | null;
};

const keyOf = (slot: GarageSlotV2): string => {
  if (slot.kind === 'filled') return `f-${slot.spot.id}`;
  if (slot.kind === 'empty') return `e-${slot.spot?.id ?? `idx-${slot.index}`}`;
  return `buy-${slot.index}`;
};

// C16: a naïve `GarageSlotV2 extends { car: infer C } ? C : never` collapses
// to `never` over the union because the `empty`/`buy` arms have no `car`.
// `Extract<GarageSlotV2, { kind: 'filled' }>['car']` selects the filled arm
// directly, preserving the real `Car` type.
type FilledCar = Extract<GarageSlotV2, { kind: 'filled' }>['car'];

const toCarPayload = (car: FilledCar): ParkingStallCarPayload => ({
  id: car.id,
  year: car.year,
  make: car.make,
  model: car.model,
  nickname: car.nickname,
  isPremiumActive: Boolean(car.isPremiumActive),
  photoUrl: car.photos[0]?.url ?? null,
});

const formatPrice = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

/**
 * Shared garage list renderer. Both /garage and /profile/garage mount this
 * with their own navigation callbacks and header. Server controls spot
 * ordering; this component does no resorting.
 */
export function GarageListView({
  slots,
  premiumTier,
  daysLeftUntilExpiry,
  highlightSpotId,
  onBadgePress,
  onBuySpot,
  onAddCar,
  onFilledCarPress,
  ListHeaderComponent,
}: Props) {
  return (
    <FlatList
      data={slots}
      keyExtractor={keyOf}
      contentContainerStyle={styles.list}
      {...(ListHeaderComponent ? { ListHeaderComponent } : {})}
      renderItem={({ item }) => {
        if (item.kind === 'filled') {
          return (
            <ParkingStallCard
              state="filled"
              source={item.source}
              slotNumber={item.index}
              car={toCarPayload(item.car)}
              premiumTier={premiumTier}
              daysLeftUntilExpiry={daysLeftUntilExpiry}
              onBadgePress={onBadgePress}
              highlight={highlightSpotId === item.spot.id}
              onPress={() => onFilledCarPress(item.car.id)}
            />
          );
        }
        if (item.kind === 'empty') {
          return (
            <ParkingStallCard
              state="empty"
              source={item.source}
              slotNumber={item.index}
              highlight={highlightSpotId === (item.spot?.id ?? null)}
              onPress={onAddCar}
            />
          );
        }
        return (
          <ParkingStallCard
            state="buy"
            source="default_free"
            slotNumber={item.index}
            priceLabel={formatPrice(item.purchaseOption.displayPriceCents)}
            onPress={onBuySpot}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { gap: theme.spacing.md, padding: theme.spacing.lg },
});
