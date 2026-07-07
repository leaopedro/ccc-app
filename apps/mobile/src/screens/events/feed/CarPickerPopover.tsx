import type { Car } from '@jdm/shared/cars';
import { PremiumBadge } from '@jdm/ui';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '~/theme';

function ModificationPills({ modifications }: { modifications: string[] }) {
  return (
    <View style={styles.pillsRow}>
      {modifications.map((mod, i) => (
        <View key={i} style={styles.pill}>
          <Text style={styles.pillText}>{mod}</Text>
        </View>
      ))}
    </View>
  );
}

type Props = {
  visible: boolean;
  cars: Car[];
  selectedCarId: string | null;
  onSelect: (car: Car) => void;
  onClose: () => void;
};

export function CarPickerPopover({ visible, cars, selectedCarId, onSelect, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal={false}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fechar seletor de carros"
      />
      <View style={styles.popover} importantForAccessibility="yes">
        <ScrollView>
          {cars.map((car) => {
            const label = `${car.nickname ?? car.make} ${car.model} ${car.year}`;
            const isSelected = car.id === selectedCarId;
            return (
              <Pressable
                key={car.id}
                onPress={() => {
                  onSelect(car);
                  onClose();
                }}
                style={[styles.item, isSelected && styles.itemSelected]}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={{ gap: 4 }}>
                  <View style={styles.itemLabelRow}>
                    <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>
                      {label}
                    </Text>
                    <PremiumBadge isPremiumActive={car.isPremiumActive} />
                  </View>
                  {car.modifications && car.modifications.length > 0 ? (
                    <ModificationPills modifications={car.modifications} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  popover: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.border,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    maxHeight: 300,
    paddingBottom: 24,
  },
  item: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  itemSelected: { backgroundColor: theme.colors.bg },
  itemLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemText: { color: theme.colors.fg, fontSize: theme.font.size.md },
  itemTextSelected: { fontWeight: '700' },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    backgroundColor: theme.colors.bg,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  pillText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
});
