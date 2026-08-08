import {
  BRAZIL_STATE_CODES,
  type PublicProfile,
  type UpdateProfileInput,
} from '@ccc/shared/profile';
import { CPF_IMMUTABLE_CODE, type ProfileStatus } from '@ccc/shared/profile-status';
import { Button } from '@ccc/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, Flag, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '~/api/client';
import { getApiErrorCode, getApiErrorMessage, getValidationFieldErrors } from '~/api/errors';
import { getProfile, getProfileStatus, updateProfile } from '~/api/profile';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { maskCpf, maskPhone } from '~/lib/masks';
import { editProfileFormResolver } from '~/screens/profile/edit-profile-form-schema';
import {
  buildUpdateProfilePayload,
  isPhoneClearingBlocked,
} from '~/screens/profile/edit-profile-payload';
import { resolveDocumentBadge } from '~/screens/profile/document-status-badge';
import { theme } from '~/theme';

const FORM_FIELDS = ['name', 'bio', 'city', 'stateCode', 'cpf', 'phone'] as const;
type FormField = (typeof FORM_FIELDS)[number];
const isFormField = (field: string): field is FormField =>
  (FORM_FIELDS as readonly string[]).includes(field);

type DocumentStatusRowProps = {
  latestDocument: ProfileStatus['latestDocument'] | undefined;
  // True only when the most recent fetch failed AND nothing has ever loaded
  // successfully (latestDocument is still undefined) -- a refetch failure
  // after a prior success stays quiet and keeps showing the last known
  // badge, see loadDocumentStatus below.
  failed: boolean;
  onPress: () => void;
};

// `latestDocument === undefined` means "not fetched yet" (quiet placeholder,
// distinct from the fetched-and-empty `null` case, which is the genuine
// pending/no-document state).
function DocumentStatusRow({ latestDocument, failed, onPress }: DocumentStatusRowProps) {
  const badge = latestDocument === undefined ? null : resolveDocumentBadge(latestDocument);
  const tone = badge?.tone === 'success' ? theme.colors.success : theme.colors.warning;
  const hint = failed
    ? profileCopy.documento.statusLoadFailed
    : badge
      ? badge.tone === 'success'
        ? profileCopy.documento.statusValidatedHint
        : profileCopy.documento.statusPendingHint
      : profileCopy.documento.statusLoading;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={profileCopy.documento.title}
      accessibilityHint={hint}
      style={styles.documentRow}
    >
      <View style={styles.documentRowLead}>
        <View style={styles.documentIconWrap}>
          {failed ? (
            <Flag color={theme.colors.warning} size={18} strokeWidth={1.75} />
          ) : badge ? (
            badge.tone === 'success' ? (
              <ShieldCheck color={tone} size={18} strokeWidth={1.75} />
            ) : (
              <Flag color={tone} size={18} strokeWidth={1.75} />
            )
          ) : (
            <ActivityIndicator size="small" color={theme.colors.muted} />
          )}
        </View>
        <View style={styles.documentTextWrap}>
          <Text style={styles.documentLabel}>{profileCopy.documento.title}</Text>
          <Text style={styles.documentHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.documentTrailing}>
        {badge ? (
          <Text style={[styles.documentBadgeText, { color: tone }]}>{badge.label}</Text>
        ) : null}
        <ChevronRight color={theme.colors.muted} size={18} strokeWidth={1.75} />
      </View>
    </Pressable>
  );
}

export default function ProfileEditScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [latestDocument, setLatestDocument] = useState<ProfileStatus['latestDocument'] | undefined>(
    undefined,
  );
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (msg: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(msg);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };

  const form = useForm<UpdateProfileInput>({
    resolver: editProfileFormResolver,
    defaultValues: { name: '', bio: '', city: '', stateCode: undefined, cpf: '', phone: '' },
  });

  // Loaded once on mount and reset into the form. Deliberately not reloaded
  // on focus (see the useFocusEffect below): resetting here on every return
  // from /profile/documento would wipe whatever the member had typed and
  // not yet saved.
  useEffect(() => {
    void (async () => {
      try {
        const loaded = await getProfile();
        setProfile(loaded);
        form.reset({
          name: loaded.name,
          bio: loaded.bio ?? '',
          city: loaded.city ?? '',
          stateCode: (loaded.stateCode as UpdateProfileInput['stateCode']) ?? undefined,
          cpf: loaded.cpf ? maskCpf(loaded.cpf) : '',
          phone: loaded.phone ? maskPhone(loaded.phone) : '',
        });
      } catch {
        showBanner(profileCopy.profile.loadFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, [form]);

  // Tracks the most recent fetch outcome. Only surfaced in the UI when
  // latestDocument is still undefined (see DocumentStatusRow's `failed`
  // prop at the call site below): a refetch failure after a prior success
  // stays quiet and keeps showing the last known badge, same as before.
  const [documentStatusFailed, setDocumentStatusFailed] = useState(false);

  const loadDocumentStatus = useCallback(async () => {
    try {
      const status = await getProfileStatus();
      setLatestDocument(status.latestDocument);
      setDocumentStatusFailed(false);
    } catch {
      setDocumentStatusFailed(true);
    }
  }, []);

  // Refetches every time this screen regains focus, so returning from
  // /profile/documento (after sending a document) updates the badge without
  // a manual refresh. Also covers the initial mount, since a screen focuses
  // when it first mounts.
  useFocusEffect(
    useCallback(() => {
      void loadDocumentStatus();
    }, [loadDocumentStatus]),
  );

  // CPF non-null on the profile currently held in state (not the value
  // loaded at mount) is what locks the field, so a save that sets the CPF
  // locks it immediately without a reload. Same reasoning for phone: once
  // the loaded/saved profile has one, it cannot be blanked back out.
  const cpfLocked = profile?.cpf != null;
  const phoneAlreadySaved = profile?.phone != null;

  const onSave = form.handleSubmit(async (values) => {
    if (isPhoneClearingBlocked(values, phoneAlreadySaved)) {
      form.setError('phone', { message: profileCopy.profile.phoneRequired });
      return;
    }
    const payload = buildUpdateProfilePayload(values, cpfLocked);
    try {
      const updated = await updateProfile(payload);
      setProfile(updated);
      showBanner(profileCopy.profile.saved);
    } catch (err) {
      // Should be unreachable from this UI (the field locks as soon as a
      // CPF exists), but handled honestly: show the server's message and
      // re-sync from the server so the field renders locked with the real
      // value instead of guessing at it.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        getApiErrorCode(err) === CPF_IMMUTABLE_CODE
      ) {
        form.setError('cpf', {
          message: getApiErrorMessage(err, profileCopy.profile.cpfImmutable),
        });
        try {
          setProfile(await getProfile());
        } catch {
          // best effort; the field still shows the error message either way
        }
        return;
      }

      // Server-side safety net: the resolver (editProfileFormSchema) already
      // blocks invalid cpf/phone and blank required fields before this
      // request is ever sent, so this branch is for whatever it does not
      // cover client-side (e.g. name/bio/city length caps, which have no
      // input limiter in the UI) or any future gap between the two schemas.
      if (err instanceof ApiError && err.status === 400) {
        const fieldErrors = getValidationFieldErrors(err);
        let handled = false;
        for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
          if (isFormField(field) && messages[0]) {
            form.setError(field, { message: messages[0] });
            handled = true;
          }
        }
        if (handled) return;
      }

      showBanner(profileCopy.profile.saveFailed);
    }
  });

  // No `next` param: DocumentoScreen's own router.replace(next) after upload
  // or "Continuar" would swap this screen's route for a fresh instance of
  // itself (StackActions.replace only swaps the top of the stack), which
  // refetches, drops any typed-but-unsaved input, and skips the "Documento
  // em análise" confirmation panel. Returning by normal back navigation
  // lets the useFocusEffect badge refetch below do its job instead.
  const goToDocumento = () => {
    router.push('/profile/documento' as never);
  };

  const retryDocumentStatus = () => {
    void loadDocumentStatus();
  };

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
        name="cpf"
        render={({ field, fieldState }) =>
          cpfLocked ? (
            <TextField
              label={profileCopy.profile.cpfLabel}
              value={maskCpf(profile?.cpf ?? '')}
              editable={false}
              hint={profileCopy.profile.cpfLockedHint}
              error={fieldState.error?.message}
            />
          ) : (
            <TextField
              label={profileCopy.profile.cpfLabel}
              placeholder={profileCopy.profile.cpfPlaceholder}
              hint={profileCopy.profile.cpfHint}
              keyboardType="number-pad"
              maxLength={14}
              value={field.value ?? ''}
              onChangeText={(text) => field.onChange(maskCpf(text))}
              error={fieldState.error?.message}
            />
          )
        }
      />
      <Controller
        control={form.control}
        name="phone"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.phoneLabel}
            placeholder={profileCopy.profile.phonePlaceholder}
            keyboardType="number-pad"
            maxLength={15}
            value={field.value ?? ''}
            onChangeText={(text) => field.onChange(maskPhone(text))}
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
      <Button
        label={profileCopy.profile.save}
        loading={form.formState.isSubmitting}
        disabled={form.formState.isSubmitting}
        onPress={() => void onSave()}
      />

      <DocumentStatusRow
        latestDocument={latestDocument}
        failed={latestDocument === undefined && documentStatusFailed}
        onPress={
          latestDocument === undefined && documentStatusFailed ? retryDocumentStatus : goToDocumento
        }
      />
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
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#111217',
  },
  documentRowLead: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  documentIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1C23',
    marginRight: theme.spacing.md,
  },
  documentTextWrap: { flex: 1, minWidth: 0, marginRight: theme.spacing.sm },
  documentLabel: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '600' },
  documentHint: { color: theme.colors.muted, fontSize: theme.font.size.md },
  documentTrailing: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  documentBadgeText: { fontSize: theme.font.size.md, fontWeight: '600' },
});
