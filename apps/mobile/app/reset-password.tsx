import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@jdm/shared/auth';
import { Button, Text } from '@jdm/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
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

import { resetPasswordRequest } from '~/api/auth';
import { ApiError } from '~/api/client';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';

const formSchema = resetPasswordSchema
  .extend({ confirm: z.string().min(1) })
  .refine((d) => d.password === d.confirm, {
    path: ['confirm'],
    message: authCopy.reset.mismatch,
  });

type FormValues = z.infer<typeof formSchema>;

const passwordTier = (pw: string): 0 | 1 | 2 | 3 => {
  const hasNum = /\d/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasSym = /[^A-Za-z0-9]/.test(pw);
  if (pw.length < 8 || !hasNum) return 0;
  let tier: 0 | 1 | 2 | 3 = 1;
  if (hasUpper && hasLower) tier = 2;
  if (tier === 2 && hasSym && pw.length >= 12) tier = 3;
  return tier;
};

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { token: token ?? '', password: '', confirm: '' },
  });

  const pw = watch('password') ?? '';
  const tier = passwordTier(pw);

  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  const onSubmit = handleSubmit(async (values) => {
    try {
      await resetPasswordRequest({ token: values.token, password: values.password });
      setDone(true);
      redirectTimer.current = setTimeout(() => {
        redirectTimer.current = null;
        router.replace('/login');
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setInvalidToken(true);
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

  if (!token || invalidToken) {
    return (
      <SafeAreaView className="flex-1 bg-bg" style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
        <View
          className="flex-1 px-5 pt-4 pb-8"
          style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
        >
          <View className="flex-row items-center pb-2 gap-3">
            <Pressable
              onPress={() => router.replace('/forgot')}
              accessibilityRole="button"
              accessibilityLabel={authCopy.common.back}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center -ml-2 active:opacity-70"
            >
              <ArrowLeft color="#F5F5F5" size={24} strokeWidth={1.75} />
            </Pressable>
          </View>
          <View className="flex-1 items-center justify-center gap-4">
            <Text variant="h2" weight="bold" className="text-center">
              {authCopy.reset.invalidLinkTitle}
            </Text>
            <Text variant="body" tone="secondary" className="text-center">
              {authCopy.reset.invalidLinkBody}
            </Text>
            <View className="pt-4 w-full">
              <Button
                label={authCopy.reset.requestNewLink}
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => router.replace('/forgot')}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

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
          <View className="flex-row items-center pt-4 pb-2 gap-3">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={authCopy.common.back}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center -ml-2 active:opacity-70"
            >
              <ArrowLeft color="#F5F5F5" size={24} strokeWidth={1.75} />
            </Pressable>
            <Text variant="h2" weight="bold">
              {authCopy.reset.title}
            </Text>
          </View>

          {done ? (
            <View className="pt-8 items-center" accessibilityLiveRegion="polite">
              <Text variant="h2" weight="bold" className="text-center pb-2">
                {authCopy.reset.done}
              </Text>
              <Text variant="body" tone="secondary" className="text-center">
                Redirecionando…
              </Text>
            </View>
          ) : (
            <>
              <View className="pt-4 pb-6">
                <Text variant="body" tone="secondary">
                  {authCopy.reset.subtitle}
                </Text>
              </View>

              <View className="gap-4">
                <View>
                  <Controller
                    control={control}
                    name="password"
                    render={({ field: { onChange, value } }) => (
                      <TextField
                        label={authCopy.reset.password}
                        secureTextEntry
                        value={value}
                        onChangeText={onChange}
                        error={errors.password?.message}
                      />
                    )}
                  />
                  {pw.length > 0 ? (
                    <View className="pt-2">
                      <View className="flex-row gap-1">
                        {[1, 2, 3].map((i) => (
                          <View
                            key={i}
                            className={
                              'flex-1 h-1 rounded-full ' +
                              (i <= tier ? 'bg-brand' : 'bg-surface-alt')
                            }
                          />
                        ))}
                      </View>
                      <Text variant="caption" tone="muted" className="pt-1">
                        {authCopy.reset.strengthLabel}:{' '}
                        {tier === 0
                          ? authCopy.reset.strengthWeak
                          : tier === 1
                            ? authCopy.reset.strengthWeak
                            : tier === 2
                              ? authCopy.reset.strengthMedium
                              : authCopy.reset.strengthStrong}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Controller
                  control={control}
                  name="confirm"
                  render={({ field: { onChange, value } }) => (
                    <TextField
                      label={authCopy.reset.confirm}
                      secureTextEntry
                      value={value}
                      onChangeText={onChange}
                      error={errors.confirm?.message}
                    />
                  )}
                />
              </View>

              <View className="pt-6">
                <Button
                  label={authCopy.reset.submit}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={isSubmitting}
                  onPress={() => void onSubmit()}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
