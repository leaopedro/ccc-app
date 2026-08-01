import { zodResolver } from '@hookform/resolvers/zod';
import { carInputSchema, type CarInput } from '@ccc/shared/cars';
import { Button } from '@ccc/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';

type CarInputForm = z.input<typeof carInputSchema>;

import { createCar } from '~/api/cars';
import { ApiError } from '~/api/client';
import { sanitizeNext } from '~/auth/redirect-intent';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
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

export default function NewCar() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = sanitizeNext(params.returnTo);
  const form = useForm<CarInputForm, unknown, CarInput>({
    resolver: zodResolver(carInputSchema),
    defaultValues: {
      make: '',
      model: '',
      year: new Date().getFullYear(),
      nickname: '',
      modifications: [],
    },
  });

  const onSave = form.handleSubmit(async (values) => {
    try {
      const car = await createCar(values);
      if (returnTo) {
        router.replace(returnTo as never);
      } else {
        router.replace(`/profile/garage/${car.id}` as never);
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        typeof err.body === 'object' &&
        err.body !== null &&
        (err.body as { error?: string }).error === 'nickname_taken'
      ) {
        form.setError('nickname', { message: profileCopy.garage.nicknameTaken });
      } else {
        Alert.alert(profileCopy.errors.unknown);
      }
    }
  });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: profileCopy.garage.newTitle,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
      <Controller
        control={form.control}
        name="make"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.makeLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="model"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.modelLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="year"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.yearLabel}
            keyboardType="number-pad"
            value={String(field.value ?? '')}
            onChangeText={(v) => field.onChange(Number(v) || 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="nickname"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.nicknameLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="modifications"
        render={({ field, fieldState }) => {
          const rawText = field.value?.join(', ') ?? '';
          return (
            <View>
              <TextField
                label={profileCopy.garage.modificationsLabel}
                hint={profileCopy.garage.modificationsHint}
                value={rawText}
                onChangeText={(v) => {
                  const items = v
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                  field.onChange(items);
                }}
                error={fieldState.error?.message}
              />
              {field.value && field.value.length > 0 ? (
                <ModificationPills modifications={field.value} />
              ) : null}
            </View>
          );
        }}
      />
      <Button label={profileCopy.garage.save} onPress={() => void onSave()} />
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
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  pill: {
    backgroundColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pillText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
});
