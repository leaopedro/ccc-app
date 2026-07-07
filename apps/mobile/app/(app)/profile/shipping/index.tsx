import type { ShippingAddressRecord } from '@jdm/shared/store';
import { Button } from '@jdm/ui';
import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { listShippingAddresses } from '~/api/store';
import { profileCopy } from '~/copy/profile';
import { formatShippingAddress } from '~/shipping/format-address';
import { getShippingExitPath, resolveShippingReturnTo } from '~/shipping/navigation';
import { theme } from '~/theme';

export default function ShippingAddressListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = resolveShippingReturnTo(params.returnTo);
  const [items, setItems] = useState<ShippingAddressRecord[] | null>(null);
  const [error, setError] = useState(false);

  const loadAddresses = useCallback(async () => {
    setError(false);
    try {
      const response = await listShippingAddresses();
      setItems(response.items);
    } catch {
      setError(true);
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadAddresses();
    }, [loadAddresses]),
  );

  const goBack = () => {
    router.replace(getShippingExitPath(returnTo) as never);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: profileCopy.shipping.title,
          headerLeft: () => (
            <Pressable onPress={goBack} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />

      <Button
        label={profileCopy.shipping.add}
        onPress={() =>
          router.push({
            pathname: '/profile/shipping/new',
            params: returnTo ? { returnTo } : undefined,
          } as never)
        }
      />

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{profileCopy.shipping.loadFailed}</Text>
          <View style={styles.retryWrap}>
            <Button label={profileCopy.profile.cancel} variant="secondary" onPress={goBack} />
            <Button label={profileCopy.shipping.retry} onPress={() => void loadAddresses()} />
          </View>
        </View>
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{profileCopy.shipping.empty}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link
              href={{
                pathname: '/profile/shipping/[id]',
                params: returnTo ? { id: item.id, returnTo } : { id: item.id },
              }}
              asChild
            >
              <Pressable
                style={styles.card}
                accessibilityRole="link"
                accessibilityLabel={item.recipientName}
                accessibilityHint={profileCopy.shipping.openDetailsHint}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.recipientName}</Text>
                  {item.isDefault ? (
                    <Text style={styles.badge}>{profileCopy.shipping.defaultBadge}</Text>
                  ) : null}
                </View>
                <Text style={styles.cardBody}>{formatShippingAddress(item)}</Text>
                <Text style={styles.cardBody}>{item.postalCode}</Text>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  retryWrap: {
    width: '100%',
    gap: theme.spacing.sm,
  },
  empty: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
  },
  list: {
    gap: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: '#111217',
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  cardTitle: {
    flex: 1,
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '600',
  },
  badge: {
    color: theme.colors.accent,
    fontSize: theme.font.size.sm,
    fontWeight: '700',
  },
  cardBody: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
  },
});
