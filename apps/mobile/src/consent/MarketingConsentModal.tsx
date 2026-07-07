import { Button } from '@jdm/ui';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

type Props = {
  visible: boolean;
  submitting: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function MarketingConsentModal({ visible, submitting, onAccept, onDecline }: Props) {
  const copy = profileCopy.consent;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} statusBarTranslucent>
      <View style={styles.container}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        <View style={styles.actions}>
          {submitting ? (
            <ActivityIndicator color={theme.colors.fg} />
          ) : (
            <>
              <Button label={copy.acceptLabel} onPress={onAccept} />
              <Button label={copy.declineLabel} onPress={onDecline} variant="ghost" />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  title: {
    color: theme.colors.fg,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  body: {
    color: theme.colors.muted,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    width: '100%',
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
});
