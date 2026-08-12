// Caixa — "Montar a caixa" placeholder.
//
// The real builder (catalog, quantity steppers, partners, review) is Fase
// 3b-2. This placeholder only exists so the home screen's primary CTA has
// somewhere to land instead of crashing while the feature is behind the
// EXPO_PUBLIC_CAIXA_ENABLED flag.

import { Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { theme } from '~/theme';

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

export default function MontarCaixaScreen() {
  return (
    <View style={styles.screen}>
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
          Montar a caixa
        </Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.body}>
        <Text variant="h3">Em breve</Text>
      </View>
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
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
