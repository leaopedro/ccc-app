import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema } from '@ccc/shared/auth';
import type { SignupInput } from '@ccc/shared/auth';
import { Button, Text } from '@ccc/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
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

import { ApiError } from '~/api/client';
import { getValidationFieldErrors } from '~/api/errors';
import { useAuth } from '~/auth/context';
import { buildLoginHref, sanitizeNext } from '~/auth/redirect-intent';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';
import { maskCpf, maskPhone, unmaskCpf, unmaskPhone } from '~/lib/masks';

// Relaxes cpf/phone to plain optional strings for the client-side resolver.
// The canonical cpfSchema/phoneSchema (via signupSchema) still run
// server-side on every submit; duplicating their checksum/format validation
// here would only block on an empty field ("" fails cpfSchema.optional(),
// since optional only skips validation for `undefined`) and would still
// need the server's 400 as the source of truth for the field-level error
// copy. Blank stays untouched by the resolver; onSubmit converts "" to
// `undefined` before calling signup().
const signupFormSchema = signupSchema.extend({
  cpf: z.string().optional(),
  phone: z.string().optional(),
});

// Builds the href for the verify-email step so the document screen can hand
// off to it after a successful upload, the same destination signup already
// reaches when no document was requested.
const buildVerifyPendingHref = (email: string, originalNext: string | null): string => {
  const params = [`email=${encodeURIComponent(email)}`];
  if (originalNext) params.push(`next=${encodeURIComponent(originalNext)}`);
  return `/verify-email-pending?${params.join('&')}`;
};

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();
  const { next: nextParam } = useLocalSearchParams<{ next?: string }>();
  const next = sanitizeNext(nextParam);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [documentIntent, setDocumentIntent] = useState(false);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: { email: '', password: '', name: '', cpf: '', phone: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!termsAccepted) {
      setTermsError(authCopy.signup.termsRequired);
      return;
    }
    setTermsError(null);
    const cpfDigits = unmaskCpf(values.cpf ?? '');
    const phoneDigits = unmaskPhone(values.phone ?? '');
    try {
      await signup({
        ...values,
        // Blank stays undefined rather than becoming an empty string, which
        // would fail cpfSchema/phoneSchema server-side (optional() only
        // skips validation for undefined, not "").
        cpf: cpfDigits.length > 0 ? cpfDigits : undefined,
        phone: phoneDigits.length > 0 ? phoneDigits : undefined,
      });
      if (documentIntent) {
        router.replace({
          pathname: '/profile/documento',
          params: { next: buildVerifyPendingHref(values.email, next) },
        } as never);
        return;
      }
      router.replace({
        pathname: '/verify-email-pending',
        params: next ? { email: values.email, next } : { email: values.email },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('email', { message: authCopy.errors.emailExists });
      } else if (err instanceof ApiError && err.status === 400) {
        const fieldErrors = getValidationFieldErrors(err);
        if (fieldErrors?.cpf?.[0]) {
          setError('cpf', { message: fieldErrors.cpf[0] });
        } else if (fieldErrors?.phone?.[0]) {
          setError('phone', { message: fieldErrors.phone[0] });
        } else {
          setError('password', { message: authCopy.errors.weakPassword });
        }
      } else if (err instanceof ApiError && err.status === 422) {
        setError('password', { message: authCopy.errors.weakPassword });
      } else if (err instanceof ApiError && err.status === 429) {
        setError('password', { message: authCopy.errors.rateLimited });
      } else if (err instanceof ApiError) {
        setError('password', { message: authCopy.errors.unknown });
      } else {
        setError('password', { message: authCopy.errors.network });
      }
    }
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

            <Pressable
              onPress={() => setDocumentIntent((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: documentIntent }}
              accessibilityLabel={authCopy.signup.documentTitle}
              hitSlop={8}
              className="flex-row items-start gap-3 active:opacity-70"
            >
              <View
                className={
                  'h-6 w-6 rounded-md border items-center justify-center mt-0.5 ' +
                  (documentIntent ? 'bg-brand border-brand' : 'border-border-strong')
                }
              >
                {documentIntent ? <Check color="#0A0A0A" size={16} strokeWidth={3} /> : null}
              </View>
              <View className="flex-1">
                <Text variant="bodySm" tone="secondary">
                  {authCopy.signup.documentTitle}
                </Text>
                <Text variant="caption" tone="muted" className="mt-1">
                  {documentIntent
                    ? authCopy.signup.documentSelectedHint
                    : authCopy.signup.documentHint}
                </Text>
              </View>
            </Pressable>

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
