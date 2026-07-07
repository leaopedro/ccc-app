import type { EventExtraPublic } from '@jdm/shared/extras';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { WizardStepDefinition, WizardStepProps } from './types';

import { buyCopy } from '~/copy/buy';
import { capacityLabel, isCapacityBlocked } from '~/lib/capacity-display';
import { formatBRL } from '~/lib/format';
import { theme } from '~/theme';

type SelectedExtra = {
  id: string;
  name: string;
  displayPriceCents: number;
};

const selectedFromData = (value: unknown): SelectedExtra[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is SelectedExtra =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as SelectedExtra).id === 'string' &&
        typeof (item as SelectedExtra).name === 'string' &&
        typeof (item as SelectedExtra).displayPriceCents === 'number',
    )
    .map((item) => ({ id: item.id, name: item.name, displayPriceCents: item.displayPriceCents }));
};

function createExtrasScreen(eventExtras: EventExtraPublic[]) {
  const sortedExtras = [...eventExtras].sort((a, b) => a.sortOrder - b.sortOrder);

  return function ExtrasStepScreen({ data, onNext, onBack }: WizardStepProps) {
    const [selected, setSelected] = useState<SelectedExtra[]>(() => selectedFromData(data.extras));
    const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);

    const toggleExtra = (extra: EventExtraPublic) => {
      const alreadySelected = selectedIds.has(extra.id);
      if (alreadySelected) {
        setSelected((prev) => prev.filter((item) => item.id !== extra.id));
        return;
      }
      if (extra.quantityRemaining === 0) return;
      setSelected((prev) => [
        ...prev,
        { id: extra.id, name: extra.name, displayPriceCents: extra.displayPriceCents },
      ]);
    };

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{buyCopy.extras.title}</Text>
          <Text style={styles.subtitle}>{buyCopy.extras.subtitle}</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {sortedExtras.map((extra) => {
            const isSelected = selectedIds.has(extra.id);
            const blocked = !isSelected && isCapacityBlocked(extra.capacityDisplay);
            const label = isSelected ? null : capacityLabel(extra.capacityDisplay);
            return (
              <Pressable
                key={extra.id}
                onPress={() => toggleExtra(extra)}
                disabled={blocked}
                style={[
                  styles.extraCard,
                  isSelected && styles.extraCardSelected,
                  blocked && styles.disabled,
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled: blocked }}
              >
                <View style={styles.extraTop}>
                  <Text style={styles.extraName}>{extra.name}</Text>
                  <Text style={styles.extraPrice}>{formatBRL(extra.displayPriceCents)}</Text>
                </View>
                {extra.description ? (
                  <Text style={styles.extraDescription}>{extra.description}</Text>
                ) : null}
                {label !== null ? <Text style={styles.extraMeta}>{label}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable onPress={onBack} style={styles.secondaryButton} accessibilityRole="button">
            <Text style={styles.secondaryLabel}>{buyCopy.wizard.back}</Text>
          </Pressable>
          <Pressable
            onPress={() => onNext({ extras: selected })}
            style={styles.primaryButton}
            accessibilityRole="button"
          >
            <Text style={styles.primaryLabel}>{buyCopy.extras.confirm}</Text>
          </Pressable>
        </View>
      </View>
    );
  };
}

export function createExtrasStep(eventExtras: EventExtraPublic[]): WizardStepDefinition {
  return {
    id: 'extras',
    label: buyCopy.extras.title,
    component: createExtrasScreen(eventExtras),
    appliesTo: () => eventExtras.length > 0,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 16, gap: 4 },
  title: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '700' },
  subtitle: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 10 },
  extraCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: 14,
    gap: 6,
  },
  extraCardSelected: {
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  disabled: { opacity: 0.5 },
  extraTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  extraName: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600', flex: 1 },
  extraPrice: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  extraDescription: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  extraMeta: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  secondaryLabel: { color: theme.colors.fg, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
  },
  primaryLabel: { color: theme.colors.fg, fontWeight: '700' },
});
