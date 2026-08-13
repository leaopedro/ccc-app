// Caixa — Pular/Voltar bottom sheet (design screen 11).
//
// Confirms skipping the current cycle. Mirrors the VariantPickerModal modal
// idiom from apps/mobile/app/(app)/store/index.tsx: a transparent RN Modal
// with a scrim + a bottom sheet card.

import { skipBox } from '~/api/box';
import { Button, Text } from '@ccc/ui';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

const SURFACE = '#0F0E0B';
const SCRIM = 'rgba(8,8,10,0.6)';

type SkipSheetProps = {
  visible: boolean;
  month: string;
  onClose: () => void;
  onDone: () => void;
};

export function SkipSheet({ visible, month, onClose, onDone }: SkipSheetProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const onConfirmSkip = async () => {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await skipBox();
      onDone();
      onClose();
    } catch {
      // Any failure (API error or a plain network/parse error) keeps the sheet
      // open with the retry message — never rethrow into an unhandled rejection.
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const handleClose = () => {
    if (pending) return;
    setError(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{caixaCopy.skipSheet.title(month)}</Text>
          <Text variant="bodySm" tone="secondary" style={styles.body}>
            {caixaCopy.skipSheet.body}
          </Text>
          {error ? (
            <Text variant="bodySm" style={styles.error}>
              {caixaCopy.loadError.body}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={caixaCopy.skipSheet.confirm}
              onPress={() => void onConfirmSkip()}
              disabled={pending}
              loading={pending}
              variant="secondary"
              className="flex-1"
            />
            <Button
              label={caixaCopy.skipSheet.cancel}
              onPress={handleClose}
              disabled={pending}
              variant="primary"
              className="flex-1"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: SCRIM,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(242,232,216,0.2)',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: theme.colors.fg,
    textAlign: 'center',
  },
  body: {
    marginTop: theme.spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  error: {
    marginTop: theme.spacing.md,
    color: theme.colors.warning,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
    width: '100%',
  },
});
