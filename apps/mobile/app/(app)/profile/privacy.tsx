import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@ccc/ui';

import { deleteAccount } from '~/api/account';
import { useAuth } from '~/auth/context';
import { profileCopy } from '~/copy/profile';
import { confirmDestructive } from '~/lib/confirm';
import { showToast } from '~/lib/toast';
import { theme } from '~/theme';

export default function PrivacyScreen() {
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const onDelete = async () => {
    const copy = profileCopy.privacy;
    const confirmed = await confirmDestructive(
      copy.deleteConfirmTitle,
      copy.deleteConfirmBody,
      copy.deleteConfirmCta,
      copy.deleteConfirmCancel,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteAccount();
    } catch {
      setDeleting(false);
      showToast(copy.deleteFailed);
      return;
    }
    showToast(copy.deleteScheduled);
    await logout();
  };

  const copy = profileCopy.privacy;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>{copy.intro}</Text>

      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>{copy.deleteTitle}</Text>
        <Text style={styles.dangerBody}>{copy.deleteExplainer}</Text>
        <Button
          label={deleting ? copy.deleting : copy.deleteButton}
          variant="danger"
          size="lg"
          fullWidth
          loading={deleting}
          disabled={deleting}
          onPress={() => void onDelete()}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.bg,
  },
  intro: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    lineHeight: 20,
  },
  dangerCard: {
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: '#3A1818',
    backgroundColor: '#111217',
    gap: theme.spacing.md,
  },
  dangerTitle: {
    color: theme.colors.accent,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  dangerBody: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    lineHeight: 20,
  },
});
