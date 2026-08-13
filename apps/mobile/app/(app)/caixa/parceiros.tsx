// Caixa — "Parceiros" (design screen 04, Fase 3b-2b).
//
// Linear step between the builder and the review screen. Composes the same
// useBox + useBoxCatalog + useBoxBuilder trio as montar.tsx and only edits the
// partner slice; the whole selection is flushed on navigate, so items chosen
// on the builder survive. Partner modules are toggles and never touch the
// budget bar (charged separately). Not open -> bounce to /caixa, same as the
// builder.

import type { BoxCatalog, BoxView } from '@ccc/shared/box';
import { Button, Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { useBoxBuilder } from '~/hooks/useBoxBuilder';
import { useBoxCatalog } from '~/hooks/useBoxCatalog';
import { isPartnerSelected } from '~/screens/caixa/builder-selection';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { EmptyState } from '~/screens/caixa/EmptyState';
import { OfflineBanner } from '~/screens/caixa/OfflineBanner';
import { PartnerModuleCard } from '~/screens/caixa/PartnerModuleCard';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const BANNER_BG = 'rgba(212,175,55,0.10)';
const GOLD_LABEL = '#C9A227';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.partners.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function PartnersBody({ box, catalog }: { box: BoxView; catalog: BoxCatalog }) {
  const builder = useBoxBuilder(box, catalog);

  const handleBack = () => {
    void builder.flush();
    goBack();
  };

  const handleReview = () => {
    // Only advance once the selection is safely saved; a failed PUT keeps the
    // user here with the retry affordance instead of opening Review over a
    // stale server selection.
    void builder.flush().then((ok) => {
      if (ok) router.push('/caixa/revisar' as never);
    });
  };

  const hasPartners = catalog.partners.length > 0;

  return (
    <View style={styles.screen}>
      <Header onBack={handleBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Text variant="bodySm" style={styles.bannerText}>
            {caixaCopy.partners.banner}
          </Text>
        </View>

        {hasPartners ? (
          catalog.partners.map((partner) => (
            <View key={partner.id} style={styles.partnerBlock}>
              <View style={styles.partnerHeader}>
                {partner.logoUrl ? (
                  <Image
                    source={{ uri: partner.logoUrl }}
                    style={styles.logo}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={[styles.logo, styles.logoFallback]} />
                )}
                <View style={styles.partnerHeaderText}>
                  <Text variant="body" weight="semibold" numberOfLines={1}>
                    {partner.name}
                  </Text>
                  {partner.description ? (
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {partner.description}
                    </Text>
                  ) : null}
                </View>
              </View>
              {partner.modules.map((module) => {
                const selected = isPartnerSelected(builder.partners, module.id);
                return (
                  <PartnerModuleCard
                    key={module.id}
                    module={module}
                    selected={selected}
                    onToggle={() => builder.setPartnerQty(module.id, selected ? 0 : 1)}
                  />
                );
              })}
            </View>
          ))
        ) : (
          <View style={styles.emptyBlock}>
            <EmptyState
              title={caixaCopy.partners.empty.title}
              body={caixaCopy.partners.empty.body}
            />
          </View>
        )}

        {builder.writeError ? (
          <Pressable onPress={() => void builder.retry()} accessibilityRole="button">
            <Text variant="caption" tone="brand" weight="semibold" style={styles.retry}>
              {caixaCopy.actions.retry}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={caixaCopy.partners.reviewCta} onPress={handleReview} />
      </View>
    </View>
  );
}

export default function ParceirosScreen() {
  const { box, loading: boxLoading, error: boxError } = useBox();
  const { catalog, loading: catalogLoading, error: catalogError } = useBoxCatalog();

  const isOpen = !!box && box.status === 'open';

  useEffect(() => {
    if (boxLoading || boxError) return;
    if (!isOpen) router.replace('/caixa' as never);
  }, [boxLoading, boxError, isOpen]);

  if (boxLoading || catalogLoading) return <CaixaSkeleton />;

  if (boxError || catalogError) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
        <Header onBack={goBack} />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.centerBody}>
            {caixaCopy.loadError.body}
          </Text>
        </View>
      </View>
    );
  }

  if (!isOpen || !box || !catalog) return <CaixaSkeleton />;

  return <PartnersBody box={box} catalog={catalog} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  headerSpacer: { width: 32 },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  banner: {
    backgroundColor: BANNER_BG,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
  },
  bannerText: { color: GOLD_LABEL },
  partnerBlock: { gap: theme.spacing.sm },
  partnerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  logo: { width: 44, height: 44, borderRadius: 10 },
  logoFallback: { backgroundColor: 'rgba(242,232,216,0.05)' },
  partnerHeaderText: { flex: 1, gap: 2 },
  emptyBlock: { paddingVertical: theme.spacing.xl },
  retry: { textAlign: 'center' },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  centerTitle: { textAlign: 'center' },
  centerBody: { textAlign: 'center', maxWidth: 280 },
  footer: {
    backgroundColor: '#0F0E0B',
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
});
