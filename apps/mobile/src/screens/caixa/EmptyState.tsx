// Caixa — generic empty state (README screen 14).
//
// Dashed gold box with an icon, a title, a body, and an optional CTA. Reused
// across the "no box this cycle" home state and, in later phases, the
// catalog/partners/address empties inside the builder.

import { Button, Text } from '@ccc/ui';
import { PackageX } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '~/theme';

const BORDER_GOLD = 'rgba(212,175,55,0.28)';
const ICON_GOLD = '#C9A227';

type IconComponent = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

type EmptyStateProps = {
  icon?: IconComponent;
  title: string;
  body: string;
  cta?: { label: string; onPress: () => void };
};

export function EmptyState({ icon: Icon = PackageX, title, body, cta }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Icon color={ICON_GOLD} size={32} strokeWidth={1.75} />
      <Text variant="body" weight="semibold" style={styles.title}>
        {title}
      </Text>
      <Text variant="bodySm" tone="muted" style={styles.body}>
        {body}
      </Text>
      {cta ? <Button label={cta.label} onPress={cta.onPress} className="mt-5" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER_GOLD,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 1.5,
    paddingHorizontal: theme.spacing.xl,
    marginHorizontal: theme.spacing.lg,
  },
  title: {
    marginTop: theme.spacing.md,
    textAlign: 'center',
  },
  body: {
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
});
