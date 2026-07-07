import { Button } from '@jdm/ui';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { resendVerifyRequest } from '~/api/auth';
import { ApiError } from '~/api/client';
import { useAuth } from '~/auth/context';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

export default function VerifyEmailPendingScreen() {
  const { user, status, logout, refreshUser } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = user?.email ?? params.email ?? '';
  const isAuthed = status === 'authenticated';
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const onResend = async () => {
    if (!email) return;
    setPending(true);
    setMessage(null);
    try {
      await resendVerifyRequest({ email });
      setMessage({ kind: 'ok', text: authCopy.verifyPending.resent });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setMessage({ kind: 'err', text: authCopy.errors.rateLimited });
      } else {
        setMessage({ kind: 'err', text: authCopy.errors.unknown });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{authCopy.verifyPending.title}</Text>
      <Text style={styles.body}>
        {email ? authCopy.verifyPending.body(email) : authCopy.verifyPending.bodyNoEmail}
      </Text>
      {message ? (
        <Text
          style={message.kind === 'ok' ? styles.ok : styles.err}
          accessibilityLiveRegion="polite"
        >
          {message.text}
        </Text>
      ) : null}
      <Button
        label={pending ? authCopy.common.loading : authCopy.verifyPending.resend}
        onPress={() => void onResend()}
      />
      {isAuthed ? (
        <>
          <Button label={authCopy.verifyPending.checkAgain} onPress={() => void refreshUser()} />
          <Button label={authCopy.common.cancel} onPress={() => void logout()} />
        </>
      ) : (
        <Link style={styles.link} href="/login" accessibilityRole="link">
          {authCopy.common.back}
        </Link>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    justifyContent: 'center',
  },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  body: { color: theme.colors.muted, fontSize: theme.font.size.md },
  ok: { color: theme.colors.fg, fontSize: theme.font.size.sm },
  err: { color: theme.colors.accent, fontSize: theme.font.size.sm },
  link: { color: theme.colors.fg, fontSize: theme.font.size.md, textDecorationLine: 'underline' },
});
