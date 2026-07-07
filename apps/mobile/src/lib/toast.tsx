import { Text } from '@jdm/ui';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '~/theme';

type ToastMessage = {
  id: number;
  message: string;
};

let publishToast: ((message: string) => void) | null = null;

export function showToast(message: string) {
  publishToast?.(message);
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    publishToast = (message: string) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setToast({ id: Date.now(), message });
    };

    return () => {
      if (publishToast) publishToast = null;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!toast) return;

    timeoutRef.current = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2400);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [toast]);

  if (!toast) return null;

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={styles.toast}>
        <Text variant="bodySm" tone="primary" weight="medium">
          {toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  toast: {
    maxWidth: '100%',
    borderRadius: theme.radii.lg,
    backgroundColor: 'rgba(18, 18, 22, 0.96)',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
});
