import { zodResolver } from '@hookform/resolvers/zod';
import { ACCOUNT_DISABLED_ERROR, loginSchema } from '@jdm/shared/auth';
import type { LoginInput } from '@jdm/shared/auth';
import { Button, Text } from '@jdm/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  View,
} from 'react-native';

import { ApiError } from '~/api/client';
import { useAuth } from '~/auth/context';
import { buildSignupHref, DEFAULT_POST_AUTH, sanitizeNext } from '~/auth/redirect-intent';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';

export default function LoginScreen() {
  const { login, flashMessage, setFlashMessage } = useAuth();
  const router = useRouter();
  const { next: nextParam } = useLocalSearchParams<{ next?: string }>();
  const next = sanitizeNext(nextParam);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      setFlashMessage(null);
      await login(values);
      // Defer to next tick so Gate re-renders with the new authenticated
      // state and mounts the target navigator (e.g. (app)) before the
      // replace fires; otherwise cross-group routes like /profile fail
      // with "action 'REPLACE' not handled by any navigator".
      setTimeout(() => router.replace((next ?? DEFAULT_POST_AUTH) as never), 0);
    } catch (err) {
      if (err instanceof ApiError) {
        const errorCode =
          typeof err.body === 'object' && err.body !== null
            ? (err.body as { error?: unknown }).error
            : undefined;
        if (err.status === 403 && errorCode === ACCOUNT_DISABLED_ERROR) {
          setFlashMessage(authCopy.errors.accountDisabled);
        } else if (err.status === 401)
          setError('password', { message: authCopy.errors.invalidCredentials });
        else if (err.status === 403)
          router.replace({
            pathname: '/verify-email-pending',
            params: next ? { email: values.email, next } : { email: values.email },
          });
        else if (err.status === 429) setError('password', { message: authCopy.errors.rateLimited });
        else setError('password', { message: authCopy.errors.unknown });
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
          <View className="items-center pt-16 pb-3">
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
              source={require('@jdm/design/assets/logo-wordmark.webp')}
              accessibilityLabel={authCopy.common.appName}
              style={{ width: 180, height: 72, resizeMode: 'contain' }}
            />
            <View style={{ height: 8 }} />
            <Text variant="bodyLg" tone="secondary" className="text-center">
              {authCopy.login.tagline}
            </Text>
          </View>

          {flashMessage ? (
            <View
              accessibilityRole="alert"
              className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2"
            >
              <Text variant="bodySm" className="text-white">
                {flashMessage}
              </Text>
            </View>
          ) : null}

          <View className="pt-6 gap-4">
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, value } }) => (
                <TextField
                  label={authCopy.login.email}
                  placeholder={authCopy.login.emailPlaceholder}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={value}
                  onChangeText={onChange}
                  error={errors.email?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, value } }) => (
                <TextField
                  label={authCopy.login.password}
                  secureTextEntry
                  autoComplete="password"
                  value={value}
                  onChangeText={onChange}
                  error={errors.password?.message}
                />
              )}
            />

            <View className="flex-row justify-end -mt-1">
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={authCopy.login.forgot}
                onPress={() => router.push('/forgot')}
                hitSlop={8}
              >
                <Text tone="muted" variant="bodySm">
                  {authCopy.login.forgot}
                </Text>
              </Pressable>
            </View>

            <View className="pt-4">
              <Button
                label={authCopy.login.submit}
                variant="primary"
                size="lg"
                fullWidth
                loading={isSubmitting}
                onPress={() => void onSubmit()}
              />
            </View>
          </View>

          <View className="flex-1" />

          <View className="flex-row items-center justify-center pt-6">
            <Text tone="muted">{authCopy.login.noAccountPrefix}</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={authCopy.login.createAccount}
              onPress={() => router.push(buildSignupHref(next) as never)}
              hitSlop={8}
            >
              <Text tone="brand" weight="semibold">
                {authCopy.login.createAccount}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
