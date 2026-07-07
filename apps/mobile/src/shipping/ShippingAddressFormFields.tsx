import { useEffect, useState } from 'react';
import { Controller, type Control, type UseFormSetValue } from 'react-hook-form';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import type { ShippingAddressFormValues } from '~/shipping/form';
import { stripCepDigits, useCepLookup } from '~/shipping/useCepLookup';
import { theme } from '~/theme';

type Props = {
  control: Control<ShippingAddressFormValues>;
  setValue: UseFormSetValue<ShippingAddressFormValues>;
  mode?: 'new' | 'edit';
};

const AUTOFILL_FIELDS = ['street', 'neighborhood', 'city', 'stateCode'] as const;

export function ShippingAddressFormFields({ control, setValue, mode = 'new' }: Props) {
  const { state, lookup } = useCepLookup();
  const [addressRevealed, setAddressRevealed] = useState(mode === 'edit');

  useEffect(() => {
    if (state.status === 'success') {
      setValue('street', state.data.street, { shouldDirty: true });
      setValue('neighborhood', state.data.neighborhood, { shouldDirty: true });
      setValue('city', state.data.city, { shouldDirty: true });
      setValue('stateCode', state.data.stateCode.toUpperCase(), { shouldDirty: true });
      setAddressRevealed(true);
    } else if (state.status === 'not_found' || state.status === 'error') {
      for (const field of AUTOFILL_FIELDS) {
        setValue(field, '', { shouldDirty: true });
      }
      setAddressRevealed(true);
    }
  }, [state, setValue]);

  const cepError =
    state.status === 'not_found'
      ? profileCopy.shipping.cepLookupNotFound
      : state.status === 'error'
        ? profileCopy.shipping.cepLookupError
        : undefined;

  return (
    <>
      <Controller
        control={control}
        name="recipientName"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.shipping.recipientNameLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.shipping.phoneLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            keyboardType="phone-pad"
          />
        )}
      />
      <Controller
        control={control}
        name="postalCode"
        render={({ field, fieldState }) => (
          <View>
            <TextField
              label={profileCopy.shipping.postalCodeLabel}
              value={field.value ?? ''}
              onChangeText={(value) => {
                field.onChange(value);
                if (stripCepDigits(value).length === 8) {
                  void lookup(value);
                }
              }}
              error={fieldState.error?.message ?? cepError}
              keyboardType="number-pad"
              maxLength={9}
              editable={state.status !== 'loading'}
            />
            {state.status === 'loading' ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.accent}
                style={styles.cepLoader}
              />
            ) : null}
          </View>
        )}
      />

      {addressRevealed ? (
        <>
          <Controller
            control={control}
            name="street"
            render={({ field, fieldState }) => (
              <TextField
                label={profileCopy.shipping.streetLabel}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="number"
            render={({ field, fieldState }) => (
              <TextField
                label={profileCopy.shipping.numberLabel}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="complement"
            render={({ field, fieldState }) => (
              <TextField
                label={profileCopy.shipping.complementLabel}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="neighborhood"
            render={({ field, fieldState }) => (
              <TextField
                label={profileCopy.shipping.neighborhoodLabel}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="city"
            render={({ field, fieldState }) => (
              <TextField
                label={profileCopy.shipping.cityLabel}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="stateCode"
            render={({ field, fieldState }) => (
              <TextField
                label={profileCopy.shipping.stateCodeLabel}
                value={field.value ?? ''}
                onChangeText={(value) => field.onChange(value.toUpperCase())}
                error={fieldState.error?.message}
                autoCapitalize="characters"
                maxLength={2}
              />
            )}
          />
        </>
      ) : null}

      <Controller
        control={control}
        name="isDefault"
        render={({ field }) => (
          <View style={styles.defaultRow}>
            <Text style={styles.defaultLabel}>{profileCopy.shipping.defaultLabel}</Text>
            <Switch
              value={field.value ?? false}
              onValueChange={field.onChange}
              trackColor={{ false: '#2A2D36', true: theme.colors.accent }}
              thumbColor="#F5F5F5"
            />
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cepLoader: {
    position: 'absolute',
    right: theme.spacing.md,
    top: 32,
  },
  defaultRow: {
    marginTop: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  defaultLabel: {
    flex: 1,
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
  },
});
