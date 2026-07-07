import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { verifyEmailChangeRequest } from '~/api/auth';
import { useAuth } from '~/auth/context';
import { buildLoginHref } from '~/auth/redirect-intent';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

type Status = 'pending' | 'done' | 'error';

export default function VerifyEmailChangeScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { logout } = useAuth();
  const [status, setStatus] = useState<Status>('pending');
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await verifyEmailChangeRequest(token);
        if (cancelled) return;
        setStatus('done');
        await logout();
        redirectTimer.current = setTimeout(() => {
          redirectTimer.current = null;
          router.replace(buildLoginHref(null) as never);
        }, 2_000);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [token, logout, router]);

  return (
    <View style={styles.container}>
      {status === 'pending' ? (
        <Text style={styles.body}>{authCopy.verifyEmailChange.loading}</Text>
      ) : null}
      {status === 'done' ? (
        <Text style={styles.body}>{authCopy.verifyEmailChange.done}</Text>
      ) : null}
      {status === 'error' ? (
        <Text style={styles.body}>{authCopy.verifyEmailChange.error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.xl,
    justifyContent: 'center',
  },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md, textAlign: 'center' },
});
