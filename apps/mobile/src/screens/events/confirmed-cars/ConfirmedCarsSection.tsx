import type { ConfirmedCar } from '@ccc/shared/events';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { eventsCopy } from '~/copy/events';
import { theme } from '~/theme';

const INLINE_MAX = 4;

type Props = {
  cars: ConfirmedCar[];
  loading: boolean;
  /** Section is hidden entirely when false (event has no car-required tiers). */
  visible: boolean;
  onSelectCar: (car: ConfirmedCar) => void;
  onOpenAllSheet: () => void;
};

export function ConfirmedCarsSection({
  cars,
  loading,
  visible,
  onSelectCar,
  onOpenAllSheet,
}: Props) {
  if (!visible) return null;

  const inlineSlice = cars.slice(0, INLINE_MAX);
  const hasOverflow = cars.length > INLINE_MAX;

  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{eventsCopy.confirmedCars.sectionTitle}</Text>

      {loading ? (
        <View style={styles.loadingRow} accessibilityLabel={eventsCopy.confirmedCars.loading}>
          <ActivityIndicator color={theme.colors.muted} />
          <Text style={styles.muted}>{eventsCopy.confirmedCars.loading}</Text>
        </View>
      ) : cars.length === 0 ? (
        <Text style={styles.muted}>{eventsCopy.confirmedCars.empty}</Text>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            accessibilityLabel={eventsCopy.confirmedCars.sectionTitle}
          >
            {inlineSlice.map((car) => (
              <Pressable
                key={car.ref}
                style={styles.avatarWrap}
                onPress={() => onSelectCar(car)}
                accessibilityRole="button"
                accessibilityLabel={`${car.make} ${car.model} ${car.year}${
                  car.isPremiumActive ? ' Premium' : ''
                }`}
                hitSlop={4}
              >
                <View>
                  {car.photoUrl ? (
                    <Image source={{ uri: car.photoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]} />
                  )}
                  {car.isPremiumActive ? (
                    <View
                      style={styles.premiumDot}
                      accessibilityLabel="Premium"
                      accessibilityRole="image"
                    />
                  ) : null}
                </View>
                <Text style={styles.avatarLabel} numberOfLines={1}>
                  {car.model}
                </Text>
              </Pressable>
            ))}

            {hasOverflow ? (
              <Pressable
                style={styles.overflowBtn}
                onPress={onOpenAllSheet}
                accessibilityRole="button"
                accessibilityLabel={eventsCopy.confirmedCars.viewAll}
              >
                <Text style={styles.overflowCount}>+{cars.length - INLINE_MAX}</Text>
                <Text style={styles.overflowLabel}>{eventsCopy.confirmedCars.viewAll}</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {hasOverflow ? (
            <Pressable
              onPress={onOpenAllSheet}
              accessibilityRole="button"
              accessibilityLabel={eventsCopy.confirmedCars.viewAll}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllLabel}>{eventsCopy.confirmedCars.viewAll}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  h2: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  muted: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  avatarWrap: {
    alignItems: 'center',
    gap: theme.spacing.xs,
    width: 64,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    backgroundColor: theme.colors.border,
  },
  premiumDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#f59e0b',
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  avatarLabel: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    textAlign: 'center',
  },
  overflowBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowCount: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '700',
  },
  overflowLabel: {
    color: theme.colors.muted,
    fontSize: 10,
  },
  viewAllBtn: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.border,
  },
  viewAllLabel: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
});
