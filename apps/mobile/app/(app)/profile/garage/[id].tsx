import { zodResolver } from '@hookform/resolvers/zod';
import { type Car, carUpdateSchema, type CarUpdateInput } from '@jdm/shared/cars';
import { Button } from '@jdm/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { addCarPhoto, deleteCar, getCar, removeCarPhoto, updateCar } from '~/api/cars';
import { ApiError } from '~/api/client';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { confirmDestructive, showMessage } from '~/lib/confirm';
import { pickAndUpload } from '~/lib/upload-image';
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

const PHOTO_SIZE = 140;

export default function CarDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [car, setCar] = useState<Car | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (message: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(message);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };

  const form = useForm<CarUpdateInput>({
    resolver: zodResolver(carUpdateSchema),
    defaultValues: {},
  });

  useEffect(() => {
    void (async () => {
      const found = await getCar(id);
      setCar(found);
      form.reset({
        make: found.make,
        model: found.model,
        year: found.year,
        nickname: found.nickname,
        modifications: found.modifications,
      });
    })();
  }, [form, id]);

  const onSave = form.handleSubmit(async (values) => {
    if (!car) return;
    try {
      const updated = await updateCar(car.id, values);
      setCar(updated);
      showBanner(profileCopy.garage.saved);
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
        showBanner(profileCopy.garage.saveFailed);
      }
    }
  });

  const photo = car?.photos[0] ?? null;

  const onAddPhoto = async () => {
    if (!car) return;
    setUploading(true);
    try {
      const up = await pickAndUpload('car_photo');
      if (!up) return;
      const updated = await addCarPhoto(car.id, {
        objectKey: up.presign.objectKey,
        width: up.picked.width,
        height: up.picked.height,
      });
      setCar(updated);
    } finally {
      setUploading(false);
    }
  };

  const onRemovePhoto = async () => {
    if (!car || !photo) return;
    const confirmed = await confirmDestructive(
      profileCopy.garage.removePhotoConfirm,
      '',
      profileCopy.garage.removePhoto,
      profileCopy.profile.cancel,
    );
    if (!confirmed) return;

    try {
      await removeCarPhoto(car.id, photo.id);
      setCar({ ...car, photos: [] });
    } catch {
      showMessage(profileCopy.errors.unknown);
    }
  };

  const onReplacePhoto = async () => {
    if (!car || !photo) return;
    setUploading(true);
    try {
      const up = await pickAndUpload('car_photo');
      if (!up) return;
      await removeCarPhoto(car.id, photo.id);
      setCar((prev) => (prev ? { ...prev, photos: [] } : prev));
      const updated = await addCarPhoto(car.id, {
        objectKey: up.presign.objectKey,
        width: up.picked.width,
        height: up.picked.height,
      });
      setCar(updated);
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async () => {
    if (!car) return;
    const confirmed = await confirmDestructive(
      profileCopy.garage.deleteConfirm,
      '',
      profileCopy.garage.delete,
      profileCopy.profile.cancel,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteCar(car.id);
      router.replace('/profile/garage' as never);
    } catch {
      showMessage(profileCopy.errors.unknown);
    } finally {
      setDeleting(false);
    }
  };

  if (!car) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const title = car.nickname ?? `${car.make} ${car.model}`;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.avatarSection}>
        {uploading ? (
          <View style={[styles.avatarBox, styles.avatarPlaceholder]}>
            <ActivityIndicator color={theme.colors.fg} />
          </View>
        ) : photo ? (
          <View style={styles.avatarBox}>
            <Image source={{ uri: photo.url }} style={styles.avatarImage} accessible={false} />
            <Pressable
              style={styles.trashBtn}
              onPress={() => void onRemovePhoto()}
              accessibilityRole="button"
              accessibilityLabel={profileCopy.garage.removePhoto}
              hitSlop={8}
            >
              <Text style={styles.trashIcon}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[styles.avatarBox, styles.avatarPlaceholder]}
            onPress={() => void onAddPhoto()}
            accessibilityRole="button"
            accessibilityLabel={profileCopy.garage.addPhoto}
          >
            <Text style={styles.placeholderIcon}>+</Text>
            <Text style={styles.placeholderLabel}>{profileCopy.garage.addPhoto}</Text>
          </Pressable>
        )}

        <Text style={styles.avatarAction}>
          {uploading ? (
            profileCopy.garage.photoUploading
          ) : photo ? (
            <Text onPress={() => void onReplacePhoto()} style={styles.link}>
              {profileCopy.garage.replacePhoto}
            </Text>
          ) : null}
        </Text>
      </View>

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

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <Button label={profileCopy.garage.save} onPress={() => void onSave()} disabled={deleting} />
      <Button
        label={deleting ? `${profileCopy.garage.delete}...` : profileCopy.garage.delete}
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
  avatarSection: {
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  avatarBox: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
  },
  avatarImage: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
  },
  avatarPlaceholder: {
    backgroundColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    color: theme.colors.muted,
    fontSize: theme.font.size.xxl,
  },
  placeholderLabel: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    marginTop: theme.spacing.xs,
  },
  trashBtn: {
    position: 'absolute',
    top: theme.spacing.xs,
    right: theme.spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trashIcon: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  avatarAction: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    minHeight: theme.font.size.sm + 4,
  },
  link: {
    color: theme.colors.fg,
    textDecorationLine: 'underline',
  },
  banner: {
    color: theme.colors.muted,
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
