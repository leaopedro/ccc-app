// Caixa — "Revisão" placeholder.
//
// The real review/confirm screen (address, final totals, confirm CTA) is
// Fase 3b-2b. This placeholder only exists so the builder's "Revisar e
// confirmar" CTA has somewhere to land.

import { Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

export default function RevisarCaixaScreen() {
  return (
    <View style={styles.screen}>
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
          Revisão
        </Text>
        <View style={styles.spacer} />
      </View>
      <View style={styles.body}>
        <Text variant="h3">{caixaCopy.builder.soon}</Text>
      </View>
    </View>
  );
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
  spacer: { width: 32 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
