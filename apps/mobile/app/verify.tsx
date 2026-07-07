import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { verifyEmailRequest } from '~/api/auth';
import { useAuth } from '~/auth/context';
import { buildLoginHref, DEFAULT_POST_AUTH, sanitizeNext } from '~/auth/redirect-intent';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

type Status = 'pending' | 'done' | 'error';

export default function VerifyScreen() {
  const { token, next: nextParam } = useLocalSearchParams<{ token?: string; next?: string }>();
  const next = sanitizeNext(nextParam);
  const router = useRouter();
  const { status: authStatus, refreshUser } = useAuth();
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
        await verifyEmailRequest({ token });
        if (cancelled) return;
        setStatus('done');
        if (authStatus === 'authenticated') {
          await refreshUser();
        }
        redirectTimer.current = setTimeout(() => {
          redirectTimer.current = null;
          if (authStatus === 'authenticated') {
            router.replace((next ?? DEFAULT_POST_AUTH) as never);
          } else {
            router.replace(buildLoginHref(next) as never);
          }
        }, 1_500);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [token, authStatus, refreshUser, router, next]);

  return (
    <View style={styles.container}>
      {status === 'pending' ? <Text style={styles.body}>{authCopy.verify.loading}</Text> : null}
      {status === 'done' ? <Text style={styles.body}>{authCopy.verify.done}</Text> : null}
      {status === 'error' ? <Text style={styles.body}>{authCopy.errors.invalidLink}</Text> : null}
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
