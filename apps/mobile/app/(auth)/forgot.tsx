import { brand } from '@jdm/design';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@jdm/shared/auth';
import type { ForgotPasswordInput } from '@jdm/shared/auth';
import { Button, Text } from '@jdm/ui';
import { useRouter } from 'expo-router';
import { ArrowLeft, Mail } from 'lucide-react-native';
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

import { forgotPasswordRequest } from '~/api/auth';
import { ApiError } from '~/api/client';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';

const obscureEmail = (email: string) => {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  if (user.length <= 2) return `${user[0] ?? ''}*@${domain}`;
  return `${user[0]}${'•'.repeat(Math.min(user.length - 2, 6))}${user[user.length - 1]}@${domain}`;
};

export default function ForgotScreen() {
  const router = useRouter();
  const [sent, setSent] = useState<{ email: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const startCooldown = () => {
    setCooldown(30);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && cooldownRef.current) {
          clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  useEffect(
    () => () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    },
    [],
  );

  const onSubmit = handleSubmit(async (values) => {
    try {
      await forgotPasswordRequest(values);
      setSent({ email: values.email });
      startCooldown();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('email', { message: authCopy.forgot.notFound });
      } else if (err instanceof ApiError && err.status === 429) {
        setError('email', { message: authCopy.errors.rateLimited });
      } else if (err instanceof ApiError) {
        setError('email', { message: authCopy.errors.unknown });
      } else {
        setError('email', { message: authCopy.errors.network });
      }
    }
  });

  const onResend = () => {
    if (cooldown > 0 || !sent) return;
    void onSubmit();
  };

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
              {authCopy.forgot.title}
            </Text>
          </View>

          {!sent ? (
            <>
              <View className="pt-4 pb-6">
                <Text variant="body" tone="secondary">
                  {authCopy.forgot.subtitle}
                </Text>
              </View>

              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, value } }) => (
                  <TextField
                    label={authCopy.forgot.email}
                    placeholder={authCopy.forgot.emailPlaceholder}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    value={value}
                    onChangeText={onChange}
                    error={errors.email?.message}
                  />
                )}
              />

              <View className="pt-6">
                <Button
                  label={authCopy.forgot.submit}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={isSubmitting}
                  onPress={() => void onSubmit()}
                />
              </View>
            </>
          ) : (
            <View className="pt-8 items-center" accessibilityLiveRegion="polite">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-tint mb-4">
                <Mail color={brand.color.brand} size={28} strokeWidth={1.75} />
              </View>
              <Text variant="h2" weight="bold" className="text-center pb-2">
                {authCopy.forgot.successTitle}
              </Text>
              <Text variant="body" tone="secondary" className="text-center">
                {authCopy.forgot.successBody(obscureEmail(sent.email))}
              </Text>
              <View className="pt-6">
                <Pressable
                  onPress={onResend}
                  accessibilityRole="button"
                  disabled={cooldown > 0}
                  hitSlop={8}
                  className="h-11 px-4 items-center justify-center active:opacity-70"
                >
                  <Text tone={cooldown > 0 ? 'muted' : 'brand'} weight="semibold">
                    {cooldown > 0 ? authCopy.forgot.resendIn(cooldown) : authCopy.forgot.resend}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          <View className="flex-1" />

          <View className="items-center pt-6">
            <Pressable
              onPress={() => router.replace('/login')}
              accessibilityRole="link"
              accessibilityLabel={authCopy.forgot.back}
              hitSlop={8}
              className="h-11 px-4 items-center justify-center active:opacity-70"
            >
              <Text tone="muted">{authCopy.forgot.back}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
