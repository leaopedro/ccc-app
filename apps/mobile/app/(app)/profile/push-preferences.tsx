import { Button } from '@jdm/ui';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { getBroadcastPreferences, updateBroadcastPreferences } from '~/api/push-preferences';
import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

export default function PushPreferencesScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [marketingEnabled, setMarketingEnabled] = useState(true);
  const [initialMarketingEnabled, setInitialMarketingEnabled] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (msg: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(msg);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };

  useEffect(() => {
    void (async () => {
      try {
        const prefs = await getBroadcastPreferences();
        setMarketingEnabled(prefs.marketing);
        setInitialMarketingEnabled(prefs.marketing);
      } catch {
        showBanner(profileCopy.pushPreferences.loadFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    },
    [],
  );

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const prefs = await updateBroadcastPreferences({ marketing: marketingEnabled });
      setMarketingEnabled(prefs.marketing);
      setInitialMarketingEnabled(prefs.marketing);
      showBanner(
        prefs.marketing
          ? profileCopy.pushPreferences.enabled
          : profileCopy.pushPreferences.disabled,
      );
    } catch {
      showBanner(profileCopy.pushPreferences.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.description}>{profileCopy.pushPreferences.description}</Text>
        <Text style={styles.notice}>{profileCopy.pushPreferences.transactionalNotice}</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{profileCopy.pushPreferences.toggleLabel}</Text>
          <Switch
            value={marketingEnabled}
            onValueChange={setMarketingEnabled}
            trackColor={{ false: '#3A1818', true: '#0F5132' }}
            thumbColor={marketingEnabled ? theme.colors.success : theme.colors.fg}
          />
        </View>
      </View>

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}

      <Button
        label={saving ? `${profileCopy.pushPreferences.save}...` : profileCopy.pushPreferences.save}
        onPress={() => void onSave()}
        disabled={saving || marketingEnabled === initialMarketingEnabled}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  card: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#111217',
  },
  description: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    lineHeight: 22,
  },
  notice: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    lineHeight: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  toggleLabel: {
    flex: 1,
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    lineHeight: 20,
  },
  banner: { color: theme.colors.muted },
});
