// Caixa — partner module card (design screen 04). Toggle add/in-box; never
// moves the budget bar (partner modules are always charged separately).

import { Text } from '@ccc/ui';
import { Check, Plus } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { formatBRL } from '~/screens/caixa/format';
import { theme } from '~/theme';

const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';
const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const SELECTED_BG = 'rgba(34,197,94,0.12)';
const SELECTED_BORDER = 'rgba(34,197,94,0.4)';

type PartnerModule = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
};

export function PartnerModuleCard({
  module,
  selected,
  onToggle,
}: {
  module: PartnerModule;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.card, selected && styles.cardSelected]}
    >
      {module.imageUrl ? (
        <Image source={{ uri: module.imageUrl }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={[styles.photo, styles.photoFallback]} />
      )}
      <View style={styles.body}>
        <Text variant="bodySm" weight="medium" numberOfLines={1}>
          {module.name}
        </Text>
        {module.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {module.description}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <Text variant="bodySm" weight="semibold" style={styles.price}>
            {formatBRL(module.priceCents)}
          </Text>
          <View style={styles.action}>
            {selected ? (
              <>
                <Check color={theme.colors.success} size={14} strokeWidth={2} />
                <Text variant="caption" weight="semibold" style={styles.inBoxText}>
                  {caixaCopy.partners.inBox}
                </Text>
              </>
            ) : (
              <>
                <Plus color={GOLD_LABEL} size={14} strokeWidth={2} />
                <Text variant="caption" weight="semibold" style={styles.addText}>
                  {caixaCopy.partners.add}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.sm,
  },
  cardSelected: {
    borderColor: SELECTED_BORDER,
    backgroundColor: SELECTED_BG,
  },
  photo: {
    width: 82,
    height: 82,
    borderRadius: 10,
  },
  photoFallback: {
    backgroundColor: 'rgba(242,232,216,0.05)',
  },
  body: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: {
    color: GOLD_LABEL,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  inBoxText: {
    color: theme.colors.success,
  },
  addText: {
    color: GOLD_LABEL,
  },
});
