import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Button } from '@ccc/ui';

import { deleteAccount } from '~/api/account';
import { createDataExport, getDataExport } from '~/api/data-export';
import { useAuth } from '~/auth/context';
import { profileCopy } from '~/copy/profile';
import { confirmDestructive } from '~/lib/confirm';
import { showToast } from '~/lib/toast';
import { theme } from '~/theme';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const EXPORT_POLL_ATTEMPTS = 20;
const EXPORT_POLL_INTERVAL_MS = 3000;

export default function PrivacyScreen() {
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    const copy = profileCopy.privacy;
    setExporting(true);
    try {
      const { id } = await createDataExport();
      for (let attempt = 0; attempt < EXPORT_POLL_ATTEMPTS; attempt += 1) {
        const job = await getDataExport(id);
        if (job.status === 'completed' && job.downloadUrl) {
          showToast(copy.exportReadyOpening);
          await WebBrowser.openBrowserAsync(job.downloadUrl);
          setExporting(false);
          return;
        }
        if (job.status === 'failed') {
          setExporting(false);
          showToast(copy.exportFailed);
          return;
        }
        await sleep(EXPORT_POLL_INTERVAL_MS);
      }
      setExporting(false);
      showToast(copy.exportSlow);
    } catch {
      setExporting(false);
      showToast(copy.exportFailed);
    }
  };

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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.exportTitle}</Text>
        <Text style={styles.cardBody}>{copy.exportExplainer}</Text>
        <Button
          label={exporting ? copy.exportWorking : copy.exportButton}
          variant="secondary"
          size="lg"
          fullWidth
          loading={exporting}
          disabled={exporting || deleting}
          onPress={() => void onExport()}
        />
      </View>

      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>{copy.deleteTitle}</Text>
        <Text style={styles.dangerBody}>{copy.deleteExplainer}</Text>
        <Button
          label={deleting ? copy.deleting : copy.deleteButton}
          variant="danger"
          size="lg"
          fullWidth
          loading={deleting}
          disabled={deleting || exporting}
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
  card: {
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: '#2A2A30',
    backgroundColor: '#111217',
    gap: theme.spacing.md,
  },
  cardTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  cardBody: {
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
