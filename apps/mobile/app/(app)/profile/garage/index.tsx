import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { getGarage, type GarageReadResponse } from '~/api/garage';
import { garageCopy } from '~/copy/garage';
import { BuySpotSheet } from '~/screens/garage/BuySpotSheet';
import { GarageHeader } from '~/screens/garage/GarageHeader';
import { GarageListView } from '~/screens/garage/GarageListView';
import { buildGarageSlots } from '~/screens/garage/garage-slots';
import { useBuySpotFlow } from '~/screens/garage/useBuySpotFlow';
import { theme } from '~/theme';

export default function ProfileGarageIndex() {
  const router = useRouter();
  const [garage, setGarage] = useState<GarageReadResponse | null>(null);
  const { buySheet, submitting, openBuySheet, closeBuySheet, goCheckout } = useBuySpotFlow();

  useFocusEffect(
    useCallback(() => {
      void (async () => setGarage(await getGarage()))();
    }, []),
  );

  const slots = useMemo(() => (garage ? buildGarageSlots(garage) : []), [garage]);

  const handleAddCar = useCallback(() => {
    router.push('/profile/garage/new' as never);
  }, [router]);

  const headerLeft = useCallback(
    () => (
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <ChevronLeft color="#F5F5F5" size={24} />
      </Pressable>
    ),
    [router],
  );

  if (!garage) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: garageCopy.garage.listTitle, headerLeft }} />
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: garageCopy.garage.listTitle, headerLeft }} />
      <GarageListView
        slots={slots}
        premiumTier={garage.garage.premiumTier}
        daysLeftUntilExpiry={garage.garage.daysLeftUntilExpiry}
        onBuySpot={() => openBuySheet(garage)}
        onAddCar={handleAddCar}
        onFilledCarPress={(carId) => router.push(`/profile/garage/${carId}` as never)}
        onBadgePress={() => undefined /* wired in chunk 08 */}
        ListHeaderComponent={
          <View style={styles.header}>
            <GarageHeader
              garage={garage.garage}
              carCount={garage.cars.length}
              onUpdated={(next) => setGarage((prev) => (prev ? { ...prev, garage: next } : prev))}
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
