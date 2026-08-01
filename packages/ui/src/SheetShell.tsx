import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { garageTokens } from './garage-tokens.js';

/**
 * Optional visual overrides. The assinaturas module owns an authoritative
 * palette of its own (see apps/mobile tier-visual.ts) and would otherwise look
 * like a different app inside this sheet. Additive and fully optional — every
 * existing caller keeps the garageTokens look.
 */
export interface SheetShellTheme {
  surface?: string;
  border?: string;
  titleColor?: string;
  titleFontFamily?: string;
}

export interface SheetShellProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
  closeLabel?: string;
  theme?: SheetShellTheme;
}

export function SheetShell({
  visible,
  title,
  onClose,
  children,
  testID,
  closeLabel,
  theme,
}: SheetShellProps) {
  const close = closeLabel ?? 'Fechar';
  const surface = theme?.surface ?? garageTokens.surface.sheet;
  const border = theme?.border ?? garageTokens.surface.border;
  const titleColor = theme?.titleColor ?? '#F5F5F5';
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable
        accessibilityLabel={close}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
      />
      <View
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: surface,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          maxHeight: '88%',
          paddingBottom: 24,
        }}
      >
        <View style={{ alignItems: 'center', paddingTop: 6 }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: garageTokens.surface.borderStrong,
            }}
          />
        </View>
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            borderBottomWidth: 1,
            borderBottomColor: border,
          }}
        >
          <Text
            style={{
              flex: 1,
              color: titleColor,
              fontSize: 15,
              fontWeight: '700',
              ...(theme?.titleFontFamily ? { fontFamily: theme.titleFontFamily } : null),
            }}
          >
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={close}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: garageTokens.surface.alt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#C9C9CD', fontSize: 18, lineHeight: 18 }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
