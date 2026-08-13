// Caixa — Preferências screen (auto-send toggle + shipping address).
//
// Read-only whenever the box isn't `open` (no box this cycle, or the box
// exists but is already locked/paid/skipped) — save is only offered while
// the member can still edit their box. Address selection reuses the
// existing `useShippingAddresses` hook + shipping nav helpers; there is no
// address form here, only a link into the existing add-address flow.

import { Button, Text } from '@ccc/ui';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { useBoxPreferences } from '~/hooks/useBoxPreferences';
import { useShippingAddresses } from '~/hooks/useShippingAddresses';
import { canEnableAutoSend, pickInitialAddressId } from '~/screens/caixa/address-select';
import { mapSaveResult, type PreferencesSaveFeedback } from '~/screens/caixa/preferences-result';
import { formatShippingAddress } from '~/shipping/format-address';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const GOLD_LABEL = '#C9A227';

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
        style={styles.backButton}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.preferences.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function openAddAddress() {
  router.push({
    pathname: '/profile/shipping/new',
    params: { returnTo: '/caixa/preferencias' },
  } as never);
}

export default function BoxPreferencesScreen() {
  const { box, loading, error, notOpen, refresh } = useBox();
  const {
    items: addresses,
    loading: loadingAddresses,
    error: addressesError,
    refresh: refreshAddresses,
  } = useShippingAddresses();
  const { save, saving } = useBoxPreferences();

  const [autoSendOptIn, setAutoSendOptIn] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PreferencesSaveFeedback | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = box?.status === 'open';

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshAddresses();
    }, [refresh, refreshAddresses]),
  );

  // Seed the toggle from the current box whenever it (re)loads.
  useEffect(() => {
    if (box) setAutoSendOptIn(box.autoSendOptIn);
  }, [box]);

  // Seed from the box first (spec: BoxView.shippingAddressId), then default,
  // without clobbering a manual selection.
  useEffect(() => {
    setSelectedAddressId((current) => {
      if (current && addresses.some((address) => address.id === current)) return current;
      return pickInitialAddressId(box?.shippingAddressId ?? null, addresses);
    });
  }, [box, addresses]);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  const showFeedback = (result: PreferencesSaveFeedback) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(result);
    if (result.kind === 'success') {
      feedbackTimer.current = setTimeout(() => setFeedback(null), 2000);
    }
  };

  const onSave = async () => {
    setFeedback(null);
    if (autoSendOptIn && !canEnableAutoSend(selectedAddressId)) {
      showFeedback({ kind: 'address_error', message: caixaCopy.preferences.autoSendNeedsAddress });
      return;
    }
    const result = await save({
      autoSendOptIn,
      ...(selectedAddressId ? { shippingAddressId: selectedAddressId } : {}),
    });
    const mapped = mapSaveResult(result);
    showFeedback(mapped);
    if (mapped.kind === 'success') {
      await refresh();
      onBack();
    }
  };

  if (loading && !box) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerBlock}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.centerBody}>
            {caixaCopy.loadError.body}
          </Text>
          <Button label={caixaCopy.actions.retry} onPress={() => void refresh()} className="mt-5" />
        </View>
      </View>
    );
  }

  if (notOpen) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.notOpen.title}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.centerBody}>
            {caixaCopy.notOpen.body}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        {!isOpen ? (
          <View style={styles.lockedBanner}>
            <Text variant="bodySm" weight="semibold" style={styles.lockedTitle}>
              {caixaCopy.preferences.locked.title}
            </Text>
            <Text variant="bodySm" tone="muted">
              {caixaCopy.preferences.locked.body}
            </Text>
          </View>
        ) : null}

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text variant="body" weight="semibold">
              {caixaCopy.preferences.autoSend}
            </Text>
            <Text variant="bodySm" tone="muted">
              {caixaCopy.preferences.autoSendHint}
            </Text>
          </View>
          <Switch
            value={autoSendOptIn}
            onValueChange={(next) => {
              if (next && !canEnableAutoSend(selectedAddressId)) {
                setFeedback({
                  kind: 'address_error',
                  message: caixaCopy.preferences.autoSendNeedsAddress,
                });
                return;
              }
              setAutoSendOptIn(next);
            }}
            disabled={!isOpen}
            trackColor={{ false: theme.colors.border, true: GOLD_LABEL }}
            thumbColor={theme.colors.fg}
          />
        </View>

        <View style={styles.section}>
          <Text variant="body" weight="semibold" style={styles.sectionTitle}>
            {caixaCopy.preferences.address}
          </Text>

          {loadingAddresses ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.addressLoading} />
          ) : addressesError ? (
            <View style={styles.addressErrorBlock}>
              <Text variant="bodySm" tone="muted">
                {caixaCopy.loadError.body}
              </Text>
              <Pressable onPress={() => void refreshAddresses()} hitSlop={8}>
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {caixaCopy.actions.retry}
                </Text>
              </Pressable>
            </View>
          ) : addresses.length === 0 ? (
            <View style={styles.noAddress}>
              <Text variant="bodySm" weight="semibold">
                {caixaCopy.empty.noAddress.title}
              </Text>
              <Text variant="bodySm" tone="muted" style={styles.noAddressBody}>
                {caixaCopy.empty.noAddress.body}
              </Text>
              {isOpen ? (
                <Pressable
                  onPress={openAddAddress}
                  accessibilityRole="button"
                  accessibilityLabel={caixaCopy.actions.addAddress}
                  style={styles.addAddressBtn}
                  hitSlop={8}
                >
                  <Plus color={theme.colors.accent} size={14} strokeWidth={2} />
                  <Text variant="bodySm" tone="brand" weight="semibold">
                    {caixaCopy.actions.addAddress}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              {addresses.map((address) => {
                const isSelected = selectedAddressId === address.id;
                return (
                  <Pressable
                    key={address.id}
                    onPress={() => isOpen && setSelectedAddressId(address.id)}
                    disabled={!isOpen}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, disabled: !isOpen }}
                    style={[styles.addressCard, isSelected && styles.addressCardSelected]}
                  >
                    <View style={styles.addressCardHeader}>
                      <Text variant="bodySm" weight="semibold" numberOfLines={1}>
                        {address.recipientName}
                      </Text>
                      {address.isDefault ? (
                        <Text variant="caption" tone="brand" weight="semibold">
                          {caixaCopy.preferences.defaultAddressBadge}
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="bodySm" tone="muted" numberOfLines={2}>
                      {formatShippingAddress(address)}
                    </Text>
                  </Pressable>
                );
              })}
              {isOpen ? (
                <Pressable
                  onPress={openAddAddress}
                  accessibilityRole="button"
                  accessibilityLabel={caixaCopy.actions.addAddress}
                  style={styles.addAddressBtn}
                  hitSlop={8}
                >
                  <Plus color={theme.colors.accent} size={14} strokeWidth={2} />
                  <Text variant="bodySm" tone="brand" weight="semibold">
                    {caixaCopy.actions.addAddress}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}

          {feedback?.kind === 'address_error' ? (
            <Text variant="bodySm" tone="danger" style={styles.feedbackText}>
              {feedback.message}
            </Text>
          ) : null}
        </View>

        {feedback?.kind === 'locked' || feedback?.kind === 'error' ? (
          <Text variant="bodySm" tone="danger" style={styles.feedbackText}>
            {feedback.message}
          </Text>
        ) : null}
        {feedback?.kind === 'success' ? (
          <Text variant="bodySm" tone="brand" style={styles.feedbackText}>
            {feedback.message}
          </Text>
        ) : null}

        {isOpen ? (
          <Button
            label={saving ? caixaCopy.preferences.saving : caixaCopy.preferences.save}
            onPress={() => void onSave()}
            disabled={saving}
            className="mt-4"
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  centerTitle: {
    textAlign: 'center',
  },
  centerBody: {
    textAlign: 'center',
    maxWidth: 280,
  },
  lockedBanner: {
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  lockedTitle: {
    color: GOLD_LABEL,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  toggleText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    marginBottom: theme.spacing.xs,
  },
  addressLoading: {
    alignSelf: 'flex-start',
  },
  addressErrorBlock: {
    gap: theme.spacing.xs,
  },
  noAddress: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  noAddressBody: {
    marginBottom: theme.spacing.xs,
  },
  addressCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    gap: 2,
  },
  addressCardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: `${theme.colors.accent}12`,
  },
  addressCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  addAddressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  feedbackText: {
    textAlign: 'center',
  },
});
