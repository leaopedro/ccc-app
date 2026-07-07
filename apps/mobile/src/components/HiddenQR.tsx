import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { theme } from '../theme';

type Props = {
  value: string;
  size: number;
  backgroundColor?: string;
  accessibilityLabel?: string;
};

const COPY = {
  hidden: 'Toque para mostrar o QR Code',
  show: 'Mostrar QR Code',
  hide: 'Ocultar QR Code',
};

export const HiddenQR = ({
  value,
  size,
  backgroundColor = '#FFFFFF',
  accessibilityLabel,
}: Props) => {
  const [revealed, setRevealed] = useState(false);
  const toggle = () => setRevealed((prev) => !prev);

  return (
    <View style={styles.container}>
      <View style={[styles.wrapper, { width: size, height: size, backgroundColor }]}>
        <View
          accessible={revealed}
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          importantForAccessibility={revealed ? 'yes' : 'no-hide-descendants'}
          aria-hidden={!revealed}
        >
          <QRCode value={value} size={size} backgroundColor={backgroundColor} />
        </View>
        {!revealed ? (
          <Pressable
            style={styles.overlay}
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={COPY.show}
            accessibilityState={{ expanded: false }}
          >
            <Eye color={theme.colors.fg} size={Math.min(48, Math.max(24, size * 0.2))} />
            <Text style={styles.hint}>{COPY.hidden}</Text>
          </Pressable>
        ) : null}
      </View>
      {revealed ? (
        <Pressable
          style={styles.toggleButton}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={COPY.hide}
          accessibilityState={{ expanded: true }}
          hitSlop={8}
        >
          <EyeOff color={theme.colors.fg} size={18} />
          <Text style={styles.hideText}>{COPY.hide}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  wrapper: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: theme.radii.sm,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  hint: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  hideText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
});
