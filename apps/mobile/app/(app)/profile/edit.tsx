import { zodResolver } from '@hookform/resolvers/zod';
import {
  BRAZIL_STATE_CODES,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@jdm/shared/profile';
import { Button } from '@jdm/ui';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getProfile, updateProfile } from '~/api/profile';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

export default function ProfileEditScreen() {
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (msg: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(msg);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: '', bio: '', city: '', stateCode: undefined },
  });

  useEffect(() => {
    void (async () => {
      try {
        const profile = await getProfile();
        form.reset({
          name: profile.name,
          bio: profile.bio ?? '',
          city: profile.city ?? '',
          stateCode: (profile.stateCode as UpdateProfileInput['stateCode']) ?? undefined,
        });
      } catch {
        showBanner(profileCopy.profile.loadFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, [form]);

  const onSave = form.handleSubmit(async (values) => {
    try {
      await updateProfile(values);
      showBanner(profileCopy.profile.saved);
    } catch {
      showBanner(profileCopy.profile.saveFailed);
    }
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.nameLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="bio"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.bioLabel}
            hint={profileCopy.profile.bioHint}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            multiline
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="city"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.cityLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="stateCode"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.stateLabel}
            value={field.value ?? ''}
            onChangeText={(v) =>
              field.onChange(v.toUpperCase().slice(0, 2) as UpdateProfileInput['stateCode'])
            }
            autoCapitalize="characters"
            maxLength={2}
            error={fieldState.error?.message}
            placeholder={BRAZIL_STATE_CODES.join(', ')}
          />
        )}
      />

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <Button label={profileCopy.profile.save} onPress={() => void onSave()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.xl, gap: theme.spacing.md, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  banner: { color: theme.colors.muted },
});
