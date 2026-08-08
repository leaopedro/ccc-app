import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema } from '@ccc/shared/auth';
import type { SignupInput } from '@ccc/shared/auth';
import type { UserDocumentType } from '@ccc/shared/documents';
import { Button, Text } from '@ccc/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  View,
} from 'react-native';
import { z } from 'zod';

import { useAuth } from '~/auth/context';
import { buildLoginHref, sanitizeNext } from '~/auth/redirect-intent';
import { type PickedSignupDocument, submitSignup } from '~/auth/signup-submit';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';
import { profileCopy } from '~/copy/profile';
import { showMessage } from '~/lib/confirm';
import { maskCpf, maskPhone } from '~/lib/masks';
import { uploadDocument } from '~/lib/upload-document';
import { ImagePickerPermissionDeniedError, pickImage } from '~/lib/upload-image';

// Relaxes cpf/phone to plain optional strings for the client-side resolver.
// The canonical cpfSchema/phoneSchema (via signupSchema) still run
// server-side on every submit; duplicating their checksum/format validation
// here would only block on an empty field ("" fails cpfSchema.optional(),
// since optional only skips validation for `undefined`) and would still
// need the server's 400 as the source of truth for the field-level error
// copy. Blank stays untouched by the resolver; submitSignup converts "" to
// `undefined` before calling signup().
const signupFormSchema = signupSchema.extend({
  cpf: z.string().optional(),
  phone: z.string().optional(),
});

const documentTypeLabel = (type: UserDocumentType): string =>
  type === 'cnh' ? profileCopy.documento.typeCnh : profileCopy.documento.typeRg;

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();
  const { next: nextParam } = useLocalSearchParams<{ next?: string }>();
  const next = sanitizeNext(nextParam);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [pickedDocument, setPickedDocument] = useState<PickedSignupDocument | null>(null);
  const [documentPickError, setDocumentPickError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: { email: '', password: '', name: '', cpf: '', phone: '' },
  });

  // Local only: no token exists before signup(), so the document cannot be
  // presigned/uploaded yet. pickImage() is local and needs none, so this
  // works here; the actual upload happens in submitSignup, after the
  // account exists.
  const handlePickDocument = async (type: UserDocumentType) => {
    setDocumentPickError(null);
    try {
      const picked = await pickImage();
      if (!picked) return; // genuine cancel: stay silent
      setPickedDocument({ type, picked });
    } catch (err) {
      if (err instanceof ImagePickerPermissionDeniedError) {
        setDocumentPickError(profileCopy.documento.pickFailed);
      }
    }
  };

  const handleRemoveDocument = () => {
    setPickedDocument(null);
    setDocumentPickError(null);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!termsAccepted) {
      setTermsError(authCopy.signup.termsRequired);
      return;
    }
    setTermsError(null);
    const outcome = await submitSignup(values, pickedDocument, { signup, uploadDocument });
    if (outcome.kind === 'error') {
      setError(outcome.field, { message: outcome.message });
      return;
    }
    if (outcome.documentUploadFailed) {
      showMessage(authCopy.signup.documentUploadFailedNotice);
    }
    // Signup always ends at the verify screen: the email-verification gate
    // in app/_layout.tsx owns every other post-signup route, so there is no
    // branch here for a document intent to reroute through.
    router.replace({
      pathname: '/verify-email-pending',
      params: next ? { email: values.email, next } : { email: values.email },
    });
  });

  return (
    <SafeAreaView className="flex-1 bg-bg" style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <KeyboardAvoidingView
        className="flex-1"
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 }}
          contentContainerClassName="px-5 pb-8 flex-grow"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row items-start pt-4 pb-2 gap-3">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={authCopy.common.back}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center -ml-2 active:opacity-70"
            >
              <ArrowLeft color="#F5F5F5" size={24} strokeWidth={1.75} />
            </Pressable>
            <View className="flex-1">
              <Text variant="bodySm" tone="muted">
                {authCopy.signup.eyebrow}
              </Text>
              <Text variant="h2" weight="bold">
                {authCopy.signup.title}
              </Text>
            </View>
          </View>

          <View className="pt-6 gap-4">
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, value } }) => (
                <TextField
                  label={authCopy.signup.name}
                  placeholder={authCopy.signup.namePlaceholder}
                  value={value}
                  onChangeText={onChange}
                  error={errors.name?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, value } }) => (
                <TextField
                  label={authCopy.signup.email}
                  placeholder={authCopy.signup.emailPlaceholder}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={value}
                  onChangeText={onChange}
                  error={errors.email?.message}
                />
              )}
            />

            <View>
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, value } }) => (
                  <TextField
                    label={authCopy.signup.password}
                    secureTextEntry
                    value={value}
                    onChangeText={onChange}
                    error={errors.password?.message}
                  />
                )}
              />
              {!errors.password?.message ? (
                <Text variant="caption" tone="muted" className="mt-2">
                  {authCopy.signup.passwordHint}
                </Text>
              ) : null}
            </View>

            <Controller
              control={control}
              name="cpf"
              render={({ field: { onChange, value } }) => (
                <TextField
                  label={authCopy.signup.cpfLabel}
                  placeholder={authCopy.signup.cpfPlaceholder}
                  hint={authCopy.signup.cpfHint}
                  keyboardType="number-pad"
                  maxLength={14}
                  value={value ?? ''}
                  onChangeText={(text) => onChange(maskCpf(text))}
                  error={errors.cpf?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="phone"
              render={({ field: { onChange, value } }) => (
                <TextField
                  label={authCopy.signup.phoneLabel}
                  placeholder={authCopy.signup.phonePlaceholder}
                  hint={authCopy.signup.phoneHint}
                  keyboardType="number-pad"
                  maxLength={15}
                  value={value ?? ''}
                  onChangeText={(text) => onChange(maskPhone(text))}
                  error={errors.phone?.message}
                />
              )}
            />

            <View className="gap-2">
              <Text variant="bodySm" tone="secondary">
                {authCopy.signup.documentTitle}
              </Text>
              {pickedDocument ? (
                <View className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3">
                  <Text variant="bodySm" tone="secondary">
                    {documentTypeLabel(pickedDocument.type)}
                  </Text>
                  <Pressable
                    onPress={handleRemoveDocument}
                    accessibilityRole="button"
                    accessibilityLabel={authCopy.signup.documentRemove}
                    hitSlop={8}
                  >
                    <X color="#8A8A93" size={18} strokeWidth={1.75} />
                  </Pressable>
                </View>
              ) : (
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={() => void handlePickDocument('cnh')}
                    accessibilityRole="button"
                    accessibilityLabel={profileCopy.documento.typeCnh}
                    className="flex-1 items-center rounded-lg border border-border-strong py-3 active:opacity-70"
                  >
                    <Text variant="bodySm" tone="secondary">
                      {profileCopy.documento.typeCnh}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handlePickDocument('rg')}
                    accessibilityRole="button"
                    accessibilityLabel={profileCopy.documento.typeRg}
                    className="flex-1 items-center rounded-lg border border-border-strong py-3 active:opacity-70"
                  >
                    <Text variant="bodySm" tone="secondary">
                      {profileCopy.documento.typeRg}
                    </Text>
                  </Pressable>
                </View>
              )}
              <Text variant="caption" tone="muted">
                {pickedDocument
                  ? authCopy.signup.documentSelectedHint
                  : authCopy.signup.documentHint}
              </Text>
              {documentPickError ? (
                <Text variant="bodySm" tone="danger">
                  {documentPickError}
                </Text>
              ) : null}
            </View>

            <View className="flex-row items-start pt-2 gap-3">
              <Pressable
                onPress={() => {
                  setTermsAccepted((v) => !v);
                  if (!termsAccepted) setTermsError(null);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
                accessibilityLabel="Aceito os termos e a política de privacidade"
                hitSlop={8}
                className="active:opacity-70"
              >
                <View
                  className={
                    'h-6 w-6 rounded-md border items-center justify-center ' +
                    (termsAccepted ? 'bg-brand border-brand' : 'border-border-strong')
                  }
                >
                  {termsAccepted ? <Check color="#0A0A0A" size={16} strokeWidth={3} /> : null}
                </View>
              </Pressable>
              <Text variant="bodySm" tone="secondary" className="flex-1">
                {authCopy.signup.termsAccept}
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {authCopy.signup.termsLink}
                </Text>
                {authCopy.signup.termsAnd}
                <Text
                  variant="bodySm"
                  tone="brand"
                  weight="semibold"
                  onPress={() => router.push('/(auth)/privacidade' as never)}
                  accessibilityRole="link"
                >
                  {authCopy.signup.privacyLink}
                </Text>
              </Text>
            </View>
            {termsError ? (
              <Text variant="bodySm" tone="danger" className="-mt-1">
                {termsError}
              </Text>
            ) : null}

            <View className="pt-4">
              <Button
                label={authCopy.signup.submit}
                variant="primary"
                size="lg"
                fullWidth
                loading={isSubmitting}
                disabled={!termsAccepted}
                onPress={() => void onSubmit()}
              />
            </View>
          </View>

          <View className="flex-1" />

          <View className="flex-row items-center justify-center pt-6">
            <Text tone="muted">{authCopy.signup.haveAccountPrefix}</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={authCopy.signup.haveAccountLink}
              onPress={() => router.replace(buildLoginHref(next) as never)}
              hitSlop={8}
            >
              <Text tone="brand" weight="semibold">
                {authCopy.signup.haveAccountLink}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
