import type { BadgeCatalogEntry, BadgeCategory, GarageBadgeOwnerState } from '@ccc/shared/badges';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { HexBadge } from './HexBadge.js';
import { garageTokens, rarityColors } from './garage-tokens.js';

// PT-BR labels for the rarity/category pill. Matches the design canon
// `categoryMeta()` at `.handoffs/.../jdma-garage/badges.jsx` lines 168–176.
const CATEGORY_LABEL: Record<BadgeCategory, string> = {
  eventos: 'Eventos',
  carros: 'Carros',
  comunidade: 'Comunidade',
  jdm: 'CCC',
};

export interface BadgeDetailProps {
  /** Catalog entry (rarity / icon / category). */
  entry: BadgeCatalogEntry;
  /** Owner-state for this badge (earned / locked / locked_premium). */
  state: GarageBadgeOwnerState;
  /** Human-readable PT-BR title — chunk 17 doesn't own copy, so the parent
   *  supplies it. The seed catalog (chunk 15) has the canon titles. */
  title?: string;
  /** Optional short description — same caveat as `title`. */
  description?: string;
  /** Current pinned-cap value from `GET /me/garage/badges` aggregation. When
   *  `pinCount >= pinCap` AND this badge is not already pinned, the pin
   *  button is disabled (a11y-disabled — still pressable for screen readers
   *  but `onTogglePin` is a no-op). */
  pinCount?: number;
  /** Cap value — chunk 19 sources this from the API config. Defaults to 3. */
  pinCap?: number;
  /** Fired on pin/unpin tap. Only rendered for earned badges. */
  onTogglePin?: (code: string) => void;
  /** When supplied, renders a "Voltar" affordance at the top of the detail
   *  view. `BadgesSheet` passes this so the drilldown can return to the
   *  catalog grid without closing the entire sheet. Matches the design
   *  canon `BadgeDetail({ onBack })` at `badges.jsx` lines 844–874. */
  onBack?: () => void;
}

const formatPtDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * BadgeDetail — drilldown for a single badge. Renders the lg HexBadge + a
 * rarity/category chip + state row (earned date OR locked criteria) and an
 * owner-only pin toggle for earned badges.
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` BadgeDetail (lines
 * 844–1057). Chunk 17 ships the primitive; chunk 19 wires the route
 * integration (sheet → API toggle → re-render).
 */
export function BadgeDetail({
  entry,
  state,
  title,
  description,
  pinCount = 0,
  pinCap = 3,
  onTogglePin,
  onBack,
}: BadgeDetailProps) {
  const r = rarityColors(entry.rarity);
  const isEarned = state.state === 'earned';
  const isPremiumLocked = state.state === 'locked_premium';
  const variant = state.state;
  const pinned = isEarned && state.pinned;
  const atCap = !pinned && pinCount >= pinCap;
  const canTogglePin = isEarned && Boolean(onTogglePin);
  const earnedDateStr = isEarned ? formatPtDate(state.earnedAt) : null;

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar para a lista de conquistas"
          onPress={onBack}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 6,
            marginBottom: 2,
            alignSelf: 'flex-start',
          })}
        >
          <ArrowLeft size={14} color="#C9C9CD" />
          <Text
            style={{
              color: '#C9C9CD',
              fontSize: 12,
              fontWeight: '600',
            }}
          >
            Voltar
          </Text>
        </Pressable>
      ) : null}
      {/* Hero card */}
      <View
        style={{
          padding: 18,
          borderRadius: 16,
          backgroundColor: garageTokens.surface.deep,
          borderWidth: 1,
          borderColor: garageTokens.surface.border,
          alignItems: 'center',
          gap: 10,
        }}
      >
        <HexBadge
          code={entry.code}
          variant={variant}
          rarity={entry.rarity}
          icon={entry.icon}
          size="lg"
        />
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: r.tint,
            borderWidth: 1,
            borderColor: `${r.main}55`,
          }}
        >
          <Text
            style={{
              color: r.main,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}
          >
            {r.label} · {CATEGORY_LABEL[entry.category]}
          </Text>
        </View>
        {title ? (
          <Text
            style={{
              color: '#F5F5F5',
              fontSize: 22,
              fontWeight: '700',
              textAlign: 'center',
              marginTop: 2,
            }}
          >
            {title}
          </Text>
        ) : null}
        <Text style={{ color: '#8A8A93', fontSize: 11, letterSpacing: 0.6 }}>{entry.code}</Text>
        {description ? (
          <Text
            style={{
              color: '#C9C9CD',
              fontSize: 13,
              lineHeight: 18,
              textAlign: 'center',
              maxWidth: 280,
            }}
          >
            {description}
          </Text>
        ) : null}
        {isPremiumLocked ? (
          <View
            style={{
              marginTop: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: garageTokens.tier.goldTint,
              borderWidth: 1,
              borderColor: `${garageTokens.tier.gold}66`,
            }}
          >
            <Text
              style={{
                color: garageTokens.tier.gold,
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 1.4,
                textTransform: 'uppercase',
              }}
            >
              Exclusivo Premium
            </Text>
          </View>
        ) : null}
      </View>

      {/* State row */}
      <View
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          backgroundColor: garageTokens.surface.sheet,
          borderWidth: 1,
          borderColor: garageTokens.surface.border,
        }}
      >
        <Text style={{ color: '#F5F5F5', fontSize: 13, fontWeight: '700' }}>
          {isEarned ? `Conquistado em ${earnedDateStr}` : 'Bloqueado'}
        </Text>
        <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 4, lineHeight: 17 }}>
          {isEarned
            ? 'Aparece no seu perfil público quando fixada.'
            : isPremiumLocked
              ? 'Disponível apenas para assinantes Premium.'
              : 'Continue participando para desbloquear esta conquista.'}
        </Text>
      </View>

      {/* Pin toggle — owner-only, earned-only */}
      {canTogglePin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pinned ? 'Desafixar do perfil público' : 'Fixar no perfil público'}
          accessibilityState={{ disabled: atCap }}
          onPress={() => {
            if (atCap) return;
            onTogglePin?.(entry.code);
          }}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : atCap ? 0.5 : 1,
            marginTop: 10,
            padding: 14,
            borderRadius: 12,
            backgroundColor: pinned ? garageTokens.brand.tint : garageTokens.surface.sheet,
            borderWidth: 1,
            borderColor: pinned ? 'rgba(212,175,55,0.45)' : garageTokens.surface.border,
          })}
        >
          <Text style={{ color: '#F5F5F5', fontSize: 13, fontWeight: '700' }}>
            {pinned ? 'Fixada no perfil público' : 'Fixar no perfil público'}
          </Text>
          <Text style={{ color: '#8A8A93', fontSize: 11, marginTop: 2 }}>
            {atCap
              ? `Você já fixou ${pinCount} conquistas (limite ${pinCap}).`
              : `Você pode fixar até ${pinCap} conquistas.`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
