import type { Car } from '@jdm/shared/cars';
import { PremiumBadge } from '@jdm/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { listCars } from '~/api/cars';
import { buyCopy } from '~/copy/buy';
import { theme } from '~/theme';

function ModificationPills({ modifications }: { modifications: string[] }) {
  return (
    <View style={styles.pillsRow}>
      {modifications.map((mod, i) => (
        <View key={i} style={styles.pill}>
          <Text style={styles.pillText}>{mod}</Text>
        </View>
      ))}
    </View>
  );
}

export const PLATE_RE = /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/;

export type CarPlatePickerSubmit = {
  carId: string;
  licensePlate: string;
  carLabel: string;
};

type Props = {
  initialCarId?: string;
  initialPlate?: string;
  submitting?: boolean;
  onSubmit: (value: CarPlatePickerSubmit) => void;
  onBack?: () => void;
  primaryLabel?: string;
};

export function CarPlatePicker({
  initialCarId,
  initialPlate,
  submitting,
  onSubmit,
  onBack,
  primaryLabel,
}: Props) {
  const router = useRouter();
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(initialCarId ?? null);
  const [plate, setPlate] = useState<string>(initialPlate ?? '');
  const [plateError, setPlateError] = useState<string | null>(null);

  const fetchCars = useCallback(async () => {
    try {
      setCars(await listCars());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchCars();
    }, [fetchCars]),
  );

  const handlePlateChange = (raw: string) => {
    const upper = raw.toUpperCase().slice(0, 8);
    setPlate(upper);
    if (plateError) setPlateError(null);
  };

  const handleSubmit = () => {
    const normalized = plate.replace(/-/g, '');
    const withDash =
      normalized.length === 7 ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : plate;
    if (!PLATE_RE.test(withDash)) {
      setPlateError(buyCopy.carPlate.plateError);
      return;
    }
    const car = cars.find((c) => c.id === selectedCarId);
    if (!car) return;
    const label = car.nickname ?? `${car.make} ${car.model} ${car.year}`;
    onSubmit({ carId: car.id, licensePlate: withDash, carLabel: label });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (cars.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{buyCopy.carPlate.subtitle}</Text>
          <Pressable
            style={styles.ctaButton}
            onPress={() =>
              router.push({ pathname: '/garage/new', params: { returnTo: '/cart' } } as never)
            }
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>{buyCopy.carPlate.emptyCta}</Text>
          </Pressable>
        </View>
        {onBack ? (
          <View style={styles.footer}>
            <Pressable onPress={onBack} style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{buyCopy.wizard.back}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const canSubmit = selectedCarId !== null && plate.length >= 7 && !submitting;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{buyCopy.carPlate.title}</Text>
        <Text style={styles.subtitle}>{buyCopy.carPlate.subtitle}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {cars.map((car) => {
          const isSelected = selectedCarId === car.id;
          const label = car.nickname ?? `${car.make} ${car.model} ${car.year}`;
          return (
            <Pressable
              key={car.id}
              style={[styles.carCard, isSelected && styles.carCardSelected]}
              onPress={() => setSelectedCarId(car.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
            >
              <View style={styles.radioOuter}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
              <View style={styles.carInfo}>
                <View style={styles.carNameRow}>
                  <Text style={styles.carName}>{label}</Text>
                  <PremiumBadge isPremiumActive={car.isPremiumActive} />
                </View>
                {car.nickname && (
                  <Text style={styles.carMeta}>
                    {car.make} {car.model} {car.year}
                  </Text>
                )}
                {car.modifications && car.modifications.length > 0 ? (
                  <ModificationPills modifications={car.modifications} />
                ) : null}
              </View>
            </Pressable>
          );
        })}

        <View style={styles.plateSection}>
          <Text style={styles.plateLabel}>{buyCopy.carPlate.plateLabel}</Text>
          <TextInput
            style={[styles.plateInput, plateError ? styles.plateInputError : null]}
            value={plate}
            onChangeText={handlePlateChange}
            placeholder={buyCopy.carPlate.platePlaceholder}
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="characters"
            maxLength={8}
            autoCorrect={false}
          />
          {plateError && <Text style={styles.errorText}>{plateError}</Text>}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.secondaryButton} accessibilityRole="button">
            <Text style={styles.secondaryLabel}>{buyCopy.wizard.back}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleSubmit}
          style={[styles.primaryButton, !canSubmit && styles.disabled]}
          disabled={!canSubmit}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.fg} />
          ) : (
            <Text style={styles.primaryLabel}>{primaryLabel ?? buyCopy.carPlate.confirm}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
  },
  header: { paddingHorizontal: 16, paddingTop: 16, gap: 4 },
  title: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '700' },
  subtitle: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 10 },
  carCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    gap: 12,
  },
  carCardSelected: { borderColor: theme.colors.accent, borderWidth: 2 },
  carInfo: { flex: 1, gap: 2 },
  carNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  carName: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  carMeta: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.accent,
  },
  plateSection: { marginTop: 8, gap: 6 },
  plateLabel: { color: theme.colors.fg, fontSize: theme.font.size.sm, fontWeight: '600' },
  plateInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: 12,
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
    letterSpacing: 2,
  },
  plateInputError: { borderColor: theme.colors.accent },
  errorText: { color: theme.colors.accent, fontSize: theme.font.size.sm },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyText: { color: theme.colors.muted, fontSize: theme.font.size.md, textAlign: 'center' },
  ctaButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent,
  },
  ctaLabel: { color: theme.colors.fg, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  secondaryLabel: { color: theme.colors.fg, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
  },
  primaryLabel: { color: theme.colors.fg, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  pill: {
    backgroundColor: theme.colors.bg,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  pillText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
});
