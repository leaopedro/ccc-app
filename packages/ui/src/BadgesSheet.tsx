import type {
  BadgeCatalogEntry,
  BadgeCategory,
  GarageBadgeOwnerState,
  GarageBadgesOwnerResponse,
} from '@ccc/shared/badges';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BadgeDetail } from './BadgeDetail.js';
import { HexBadge } from './HexBadge.js';
import { SheetShell } from './SheetShell.js';
import { garageTokens } from './garage-tokens.js';

const CATEGORY_LABEL: Record<BadgeCategory, string> = {
  eventos: 'Eventos',
  carros: 'Carros',
  comunidade: 'Comunidade',
  jdm: 'CCC',
};

const CATEGORY_ORDER: BadgeCategory[] = ['eventos', 'carros', 'comunidade', 'jdm'];

type TabFilter = 'all' | BadgeCategory;
const TABS: { id: TabFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'carros', label: 'Carros' },
  { id: 'comunidade', label: 'Comunidade' },
  { id: 'jdm', label: 'CCC' },
];

export interface BadgesSheetCopy {
  /** PT-BR title + description per code — supplied by chunk 19 (the route
   *  layer owns copy; the primitive stays purely visual). */
  title?: string;
  description?: string;
}

export interface BadgesSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Owner shape from `GET /me/garage/badges`. */
  data: GarageBadgesOwnerResponse;
  /** Tap a locked or locked_premium tile — chunk 19 wires the upsell. */
  onLockedPress: (code: string) => void;
  /** Pin toggle — only invoked for earned badges in the detail view. */
  onTogglePin?: (code: string) => void;
  /** Current pinned-cap usage — passed straight through to `BadgeDetail`. */
  pinCount?: number;
  /** Cap value (defaults to 3). */
  pinCap?: number;
  /** Optional PT-BR copy keyed by badge code. Missing entries fall back to
   *  the bare code in the detail header. */
  copy?: Record<string, BadgesSheetCopy | undefined>;
  testID?: string;
}

const stateByCode = (badges: GarageBadgeOwnerState[]): Map<string, GarageBadgeOwnerState> =>
  new Map(badges.map((b) => [b.code, b]));

/**
 * BadgesSheet — full-catalog grid drawer. Top-level shows every catalog
 * entry grouped by category (eventos / carros / comunidade / jdm). Tap a
 * tile to drill into `BadgeDetail`. Locked tiles route to `onLockedPress`
 * instead of drilldown so chunk 19 can show the upsell sheet (§C11
 * precedent).
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` BadgesSheet (lines
 * 674–836). The RN port keeps the same category sectioning + drilldown
 * inline pattern; uses `SheetShell` for chrome.
 */
export function BadgesSheet({
  visible,
  onClose,
  data,
  onLockedPress,
  onTogglePin,
  pinCount,
  pinCap,
  copy,
  testID,
}: BadgesSheetProps) {
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [tabFilter, setTabFilter] = useState<TabFilter>('all');
  const byCode = useMemo(() => stateByCode(data.badges), [data.badges]);
  const grouped = useMemo(() => {
    const map = new Map<BadgeCategory, BadgeCatalogEntry[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const entry of data.catalog) {
      const bucket = map.get(entry.category);
      if (bucket) bucket.push(entry);
    }
    return map;
  }, [data.catalog]);

  const earnedCount = data.badges.filter((b) => b.state === 'earned').length;
  const totalCatalog = data.catalog.length;
  const detailEntry = detailCode ? data.catalog.find((c) => c.code === detailCode) : null;
  const detailState = detailCode ? byCode.get(detailCode) : null;
  const detailCopy = detailCode ? copy?.[detailCode] : undefined;

  const close = () => {
    setDetailCode(null);
    onClose();
  };

  return (
    <SheetShell
      visible={visible}
      title={detailEntry ? 'Conquista' : 'Suas conquistas'}
      onClose={close}
      {...(testID !== undefined ? { testID } : {})}
    >
      {detailEntry && detailState ? (
        <BadgeDetail
          entry={detailEntry}
          state={detailState}
          {...(detailCopy?.title !== undefined ? { title: detailCopy.title } : {})}
          {...(detailCopy?.description !== undefined
            ? { description: detailCopy.description }
            : {})}
          {...(pinCount !== undefined ? { pinCount } : {})}
          {...(pinCap !== undefined ? { pinCap } : {})}
          {...(onTogglePin ? { onTogglePin } : {})}
          onBack={() => setDetailCode(null)}
        />
      ) : (
        <View style={{ paddingBottom: 8 }}>
          {/* Summary */}
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 10,
              padding: 14,
              borderRadius: 12,
              backgroundColor: garageTokens.surface.deep,
              borderWidth: 1,
              borderColor: garageTokens.surface.border,
            }}
          >
            <Text
              style={{
                color: '#F5F5F5',
                fontSize: 28,
                fontWeight: '700',
                fontVariant: ['tabular-nums'],
              }}
            >
              {earnedCount}
              <Text style={{ color: '#8A8A93', fontSize: 18 }}>/{totalCatalog}</Text>
            </Text>
            <Text style={{ color: '#C9C9CD', fontSize: 12, marginTop: 4 }}>
              Toque uma conquista para ver os detalhes ou fixá-la no perfil público.
            </Text>
          </View>

          {/* Category tabs */}
          <View
            style={{
              flexDirection: 'row',
              gap: 6,
              paddingHorizontal: 12,
              marginTop: 12,
              flexWrap: 'wrap',
            }}
          >
            {TABS.map((t) => {
              const active = tabFilter === t.id;
              return (
                <Pressable
                  key={t.id}
                  testID={`badges-tab-${t.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTabFilter(t.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    backgroundColor: active ? garageTokens.brand.base : 'transparent',
                    borderColor: active ? garageTokens.brand.base : garageTokens.surface.border,
                  }}
                >
                  <Text
                    style={{
                      color: active ? '#FFFFFF' : '#C9C9CD',
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Category sections */}
          {CATEGORY_ORDER.map((cat) => {
            if (tabFilter !== 'all' && tabFilter !== cat) return null;
            const entries = grouped.get(cat) ?? [];
            if (entries.length === 0) return null;
            return (
              <View key={cat} style={{ marginTop: 16, paddingHorizontal: 16 }}>
                <Text
                  style={{
                    color: '#F5F5F5',
                    fontSize: 12,
                    fontWeight: '700',
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  {CATEGORY_LABEL[cat]}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 14,
                  }}
                >
                  {entries.map((entry) => {
                    const state = byCode.get(entry.code);
                    if (!state) return null;
                    const variant = state.state;
                    const onPress =
                      variant === 'earned'
                        ? () => setDetailCode(entry.code)
                        : () => onLockedPress(entry.code);
                    return (
                      <HexBadge
                        key={entry.code}
                        code={entry.code}
                        variant={variant}
                        rarity={entry.rarity}
                        icon={entry.icon}
                        size="md"
                        onPress={onPress}
                      />
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </SheetShell>
  );
}
