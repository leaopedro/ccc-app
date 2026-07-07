import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { theme } from '~/theme';

export default function LegacyBuyRouteScreen() {
  const { eventSlug, tierId } = useLocalSearchParams<{ eventSlug: string; tierId?: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!eventSlug || typeof eventSlug !== 'string') return;
    router.replace({
      pathname: '/events/[slug]',
      params: {
        slug: eventSlug,
        ...(typeof tierId === 'string' ? { tierId } : {}),
      },
    } as never);
  }, [eventSlug, tierId, router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
