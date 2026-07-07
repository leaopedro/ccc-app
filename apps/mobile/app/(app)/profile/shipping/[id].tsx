import { Button } from '@jdm/ui';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteShippingAddress, listShippingAddresses, updateShippingAddress } from '~/api/store';
import { profileCopy } from '~/copy/profile';
import { confirmDestructive, showMessage } from '~/lib/confirm';
import { ShippingAddressFormFields } from '~/shipping/ShippingAddressFormFields';
import {
  emptyShippingAddressFormValues,
  fromShippingAddressRecord,
  toShippingAddressInput,
  type ShippingAddressFormValues,
} from '~/shipping/form';
import { getShippingListPath, resolveShippingReturnTo } from '~/shipping/navigation';
import { theme } from '~/theme';

export default function ShippingAddressDetailScreen() {
  const { id, returnTo: rawReturnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const router = useRouter();
  const returnTo = resolveShippingReturnTo(rawReturnTo);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(profileCopy.shipping.title);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const form = useForm<ShippingAddressFormValues>({
    defaultValues: emptyShippingAddressFormValues,
  });

  const showBanner = (message: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(message);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };

  const loadAddress = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listShippingAddresses();
      const address = response.items.find((item) => item.id === id);
      if (!address) {
        showBanner(profileCopy.shipping.loadFailed);
        return;
      }
      setTitle(address.recipientName);
      form.reset(fromShippingAddressRecord(address));
    } catch {
      showBanner(profileCopy.shipping.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [form, id]);

  useFocusEffect(
    useCallback(() => {
      void loadAddress();
    }, [loadAddress]),
  );

  const onSave = form.handleSubmit(async (values) => {
    form.clearErrors();
    const parsed = toShippingAddressInput(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && field in values) {
          form.setError(field as keyof ShippingAddressFormValues, { message: issue.message });
        }
      }
      return;
    }

    try {
      const updated = await updateShippingAddress(id, parsed.data);
      setTitle(updated.recipientName);
      form.reset(fromShippingAddressRecord(updated));
      if (returnTo) {
        router.replace(returnTo as never);
        return;
      }
      showBanner(profileCopy.shipping.saved);
    } catch {
      showBanner(profileCopy.shipping.saveFailed);
    }
  });

  const onDelete = async () => {
    const confirmed = await confirmDestructive(
      profileCopy.shipping.deleteConfirm,
      '',
      profileCopy.shipping.delete,
      profileCopy.profile.cancel,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteShippingAddress(id);
      router.replace(getShippingListPath(returnTo) as never);
    } catch {
      showMessage(profileCopy.errors.unknown);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen
          options={{
            title,
            headerLeft: () => (
              <Pressable
                onPress={() => router.replace(getShippingListPath(returnTo) as never)}
                hitSlop={8}
              >
                <ChevronLeft color="#F5F5F5" size={24} />
              </Pressable>
            ),
          }}
        />
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable
              onPress={() => router.replace(getShippingListPath(returnTo) as never)}
              hitSlop={8}
            >
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
      <ShippingAddressFormFields control={form.control} setValue={form.setValue} mode="edit" />
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <Button label={profileCopy.shipping.save} onPress={() => void onSave()} disabled={deleting} />
      <Button
        label={deleting ? profileCopy.shipping.deleting : profileCopy.shipping.delete}
        onPress={() => void onDelete()}
        disabled={deleting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  banner: {
    color: theme.colors.muted,
  },
});
