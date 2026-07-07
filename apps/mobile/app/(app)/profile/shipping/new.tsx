import { Button } from '@jdm/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { createShippingAddress } from '~/api/store';
import { profileCopy } from '~/copy/profile';
import { showMessage } from '~/lib/confirm';
import { ShippingAddressFormFields } from '~/shipping/ShippingAddressFormFields';
import {
  emptyShippingAddressFormValues,
  toShippingAddressInput,
  type ShippingAddressFormValues,
} from '~/shipping/form';
import {
  getShippingListPath,
  getShippingSavePath,
  resolveShippingReturnTo,
} from '~/shipping/navigation';
import { theme } from '~/theme';

export default function NewShippingAddressScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = resolveShippingReturnTo(params.returnTo);
  const form = useForm<ShippingAddressFormValues>({
    defaultValues: emptyShippingAddressFormValues,
  });

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
      const address = await createShippingAddress(parsed.data);
      router.replace(getShippingSavePath(address.id, returnTo) as never);
    } catch {
      showMessage(profileCopy.shipping.saveFailed);
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: profileCopy.shipping.newTitle,
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
      <ShippingAddressFormFields control={form.control} setValue={form.setValue} mode="new" />
      <Button label={profileCopy.shipping.save} onPress={() => void onSave()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
});
