import {
  Car,
  Crown,
  Flag,
  Heart,
  type LucideIcon,
  Medal,
  MessageSquare,
} from 'lucide-react-native';
import {
  Modal,
  Pressable,
  ScrollView,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { garageTokens } from './garage-tokens.js';

export interface XPRule {
  key:
    | 'event_checkin'
    | 'car_create'
    | 'post_create'
    | 'post_like'
    | 'badge_award_common'
    | 'badge_award_rare'
    | 'badge_award_legendary'
    | 'premium_activation';
  icon: LucideIcon;
  iconColor: string;
  /** PT-BR locked copy. */
  label: string;
  /** Positive integer delta — mirrors outline §437. */
  delta: number;
}

/**
 * XP_RULES — canonical user-facing list (8 entries). Mirrors outline §437
 * but drops `post_like (revert)` (inverse op) + `admin_adjustment`
 * (moderator-only) and lists the 3 `badge_award` rarities separately, per
 * outline §301. Single source of truth for user-visible XP copy; server
 * deltas live in the awarder service. The contract test
 * (`__tests__/XPTooltip.test.tsx` → "matches the awarder deltas at outline
 * §437") locks this table against accidental UI-side edits — it asserts
 * the hardcoded outline values, NOT an import of the server/shared map,
 * so a server-side delta change still has to be mirrored here by hand.
 */
export const XP_RULES: readonly XPRule[] = [
  {
    key: 'event_checkin',
    icon: Flag,
    iconColor: garageTokens.brand.base,
    label: 'Check-in em evento',
    delta: 10,
  },
  {
    key: 'car_create',
    icon: Car,
    iconColor: '#C9C9CD',
    label: 'Adicionar carro à garagem',
    delta: 5,
  },
  {
    key: 'post_create',
    icon: MessageSquare,
    iconColor: '#C9C9CD',
    label: 'Publicar no feed',
    delta: 2,
  },
  {
    key: 'post_like',
    icon: Heart,
    iconColor: garageTokens.brand.base,
    label: 'Curtida recebida em post',
    delta: 1,
  },
  {
    key: 'badge_award_common',
    icon: Medal,
    iconColor: garageTokens.rarity.common,
    label: 'Conquistar uma medalha comum',
    delta: 25,
  },
  {
    key: 'badge_award_rare',
    icon: Medal,
    iconColor: garageTokens.rarity.rare,
    label: 'Conquistar uma medalha rara',
    delta: 50,
  },
  {
    key: 'badge_award_legendary',
    icon: Medal,
    iconColor: garageTokens.rarity.legendary,
    label: 'Conquistar uma medalha lendária',
    delta: 100,
  },
  {
    key: 'premium_activation',
    icon: Crown,
    iconColor: garageTokens.tier.gold,
    label: 'Ativar Premium (bônus único)',
    delta: 200,
  },
] as const;

export interface XPTooltipProps {
  visible: boolean;
  /** Fires on backdrop tap or Android back. */
  onClose: () => void;
  /** `${testID}-backdrop` is exposed on the dim layer. */
  testID?: string;
}

const FOOTER_DISCLAIMER =
  'XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação.';

const ruleRowStyle: StyleProp<ViewStyle> = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: garageTokens.surface.border,
};
const iconWrapStyle: StyleProp<ViewStyle> = {
  width: 32,
  height: 32,
  borderRadius: 8,
  marginRight: 12,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: garageTokens.surface.alt,
};
const deltaStyle = {
  color: garageTokens.brand.base,
  fontSize: 13,
  marginLeft: 8,
  fontWeight: '700' as const,
  fontVariant: ['tabular-nums'] as Array<'tabular-nums'>,
};
const footerNoteStyle: StyleProp<ViewStyle> = {
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: garageTokens.surface.borderStrong,
  backgroundColor: garageTokens.surface.deep,
};

/**
 * XPTooltip — centered overlay with the 8 XP_RULES + dashed-bordered
 * footer disclaimer. **Centered card, NOT a bottom sheet** — canonical
 * deviation from Phase 1's `SheetShell` pattern (outline §2C.38).
 *
 * Backdrop is a 45%-black dim `Pressable` rendered as a flex:1 sibling
 * of the centered card View (sibling layout mirrors `SheetShell.tsx`).
 * The card sits absolute-positioned in front of the backdrop and
 * naturally intercepts touches — no nested Pressable needed and no
 * nested interactive controls. Backdrop-tap dispatches `onClose`;
 * Android hardware back fires `Modal.onRequestClose`, also routed to
 * `onClose`. Blur via `expo-blur` was planned per outline §2C.38 but
 * deferred to Phase 2D: the runtime `expo-blur` peer-dep tips the
 * React/ReactDOM lockfile hoist and fails admin's vitest run with a
 * null hook dispatcher.
 *
 * Mobile-only (canon §12). SSR's `ProfileStatsWeb` never mounts this
 * component — the `?` renders static instead.
 *
 * Stateless — composer (chunk 39 `ProfileStats`) owns `visible`.
 */
export function XPTooltip({ visible, onClose, testID }: XPTooltipProps) {
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      {...(testID !== undefined ? { testID } : {})}
    >
      {/* Sibling layout matches SheetShell.tsx: backdrop Pressable +
       * absolute-positioned card View. The card sits in front of the
       * backdrop and naturally intercepts touches so the inside-press
       * does not bubble to onClose. Earlier nested-Pressable form
       * created nested interactive controls (a11y grouping smell) and
       * triggered act() warnings on jsdom; the sibling form has neither. */}
      <Pressable
        accessibilityLabel="Fechar"
        accessibilityRole="button"
        onPress={onClose}
        {...(testID !== undefined ? { testID: `${testID}-backdrop` } : {})}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
      />
      <View
        accessibilityViewIsModal
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          padding: 20,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          {...(testID !== undefined ? { testID: `${testID}-card` } : {})}
          style={{
            width: '100%',
            maxWidth: 360,
            maxHeight: '80%',
            borderRadius: 18,
            borderWidth: 1,
            paddingTop: 18,
            paddingBottom: 16,
            paddingHorizontal: 16,
            backgroundColor: garageTokens.surface.sheet,
            borderColor: garageTokens.surface.border,
          }}
        >
          <Text style={{ color: '#F5F5F5', fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
            Como ganhar XP
          </Text>
          <Text style={{ color: '#C9C9CD', fontSize: 12, marginBottom: 14 }}>
            Suas ações na comunidade somam pontos.
          </Text>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 4 }}>
            {XP_RULES.map((rule) => {
              const Icon = rule.icon;
              return (
                <View key={rule.key} style={ruleRowStyle}>
                  <View style={iconWrapStyle}>
                    <Icon size={18} color={rule.iconColor} />
                  </View>
                  <Text style={{ flex: 1, color: '#F5F5F5', fontSize: 13 }}>{rule.label}</Text>
                  <Text style={deltaStyle}>+{rule.delta} XP</Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={footerNoteStyle}>
            <Text style={{ color: '#C9C9CD', fontSize: 11, lineHeight: 16 }}>
              {FOOTER_DISCLAIMER}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}
