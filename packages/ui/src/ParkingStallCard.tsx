import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { PremiumBadge } from './PremiumBadge.js';
import { garageTokens, type GaragePremiumTier } from './garage-tokens.js';

// Four sources, mirrors `packages/shared/src/garage.ts` garageSpotSourceSchema.
// purchase and premium_membership paint identically (extra gold rail + RESERVADA
// tape) — premium_membership is a subscription-derived "extra" slot.
export type StallSource = 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';

type StallState = 'filled' | 'empty' | 'buy';

export interface ParkingStallCarPayload {
  id: string;
  year: number;
  make: string;
  model: string;
  nickname?: string | null;
  isPremiumActive?: boolean | null;
  photoUrl?: string | null;
}

export interface ParkingStallCardProps {
  slotNumber: number;
  source: StallSource;
  state: StallState;
  car?: ParkingStallCarPayload;
  premiumTier?: GaragePremiumTier | null;
  daysLeftUntilExpiry?: number | null;
  onBadgePress?: () => void;
  priceLabel?: string;
  onPress: () => void;
  highlight?: boolean;
  testID?: string;
}

const paintFor = (source: StallSource, state: StallState): string => {
  if (state === 'buy') return garageTokens.brand.soft;
  if (source === 'purchase' || source === 'premium_membership') return garageTokens.paint.extra;
  if (source === 'admin_grant') return garageTokens.paint.adminGrant;
  return garageTokens.paint.free;
};

const tapeLabel = (source: StallSource, state: StallState): string | null => {
  if (state === 'buy') return 'À VENDA';
  if (source === 'purchase' || source === 'premium_membership') return 'RESERVADA';
  if (source === 'admin_grant') return 'CORTESIA';
  return null;
};

const subtitleFor = (source: StallSource): string => {
  if (source === 'purchase' || source === 'premium_membership') return 'Vaga extra disponível';
  if (source === 'admin_grant') return 'Vaga concedida disponível';
  return 'Use uma das suas vagas grátis';
};

const tapeTintFor = (source: StallSource, state: StallState): string => {
  if (state === 'buy') return garageTokens.brand.tint;
  if (source === 'admin_grant') return 'rgba(74,212,224,0.18)';
  // purchase + premium_membership share the gold tint
  return 'rgba(232,179,57,0.18)';
};

/**
 * AsphaltGrid — the floor texture behind the painted rails. SVG `Pattern`
 * tiles a 4x4pt cell of crossed asphalt lines. The two skewed chevrons sit
 * on top as an "entry hint", matching `atoms.jsx` StallFloor (lines 813–945).
 *
 * Why react-native-svg: RN has no `repeating-linear-gradient`, and stacking
 * ~60 absolutely-positioned `View`s for a grid is wasteful. `Pattern` is the
 * native primitive here.
 */
function AsphaltGrid({ paint }: { paint: string }) {
  return (
    <>
      <Svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        pointerEvents="none"
      >
        <Defs>
          <Pattern id="asphalt" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <Line
              x1="0"
              y1="0"
              x2="4"
              y2="0"
              stroke={garageTokens.paint.asphaltLine}
              strokeWidth="1"
            />
            <Line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke={garageTokens.paint.asphaltLine}
              strokeWidth="1"
            />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#asphalt)" />
      </Svg>
      {/* Two skewed chevron strips — entry hint at top of stall. */}
      <View
        style={{
          position: 'absolute',
          top: 14,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 4,
        }}
        pointerEvents="none"
      >
        <View
          style={{
            width: 18,
            height: 2,
            backgroundColor: paint,
            opacity: 0.45,
            transform: [{ skewX: '-30deg' }],
          }}
        />
        <View
          style={{
            width: 18,
            height: 2,
            backgroundColor: paint,
            opacity: 0.45,
            transform: [{ skewX: '-30deg' }],
          }}
        />
      </View>
    </>
  );
}

/**
 * ParkingStallCard — three-state stall vocabulary (filled / empty / buy)
 * with source-aware paint. Replaces the legacy dashed-border
 * Add/Fill/Buy placeholder family.
 *
 * Visual canon: `.handoffs/.../jdma-garage/atoms.jsx` StallFloor +
 * FilledStallCard + EmptyStallCard + BuySpotStallCard (lines 813–1200).
 */
export function ParkingStallCard({
  slotNumber,
  source,
  state,
  car,
  premiumTier = null,
  daysLeftUntilExpiry = null,
  onBadgePress,
  priceLabel,
  onPress,
  highlight = false,
  testID,
}: ParkingStallCardProps) {
  const paint = paintFor(source, state);
  const tape = tapeLabel(source, state);
  const tapeTint = tapeTintFor(source, state);
  const slotPlate = `SLOT ${String(slotNumber).padStart(2, '0')}`;

  const a11yLabel =
    state === 'filled' && car
      ? `Vaga ${slotNumber}, ${car.year} ${car.make} ${car.model}`
      : state === 'buy'
        ? 'Comprar vaga adicional'
        : `Vaga ${slotNumber} vazia`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: garageTokens.surface.sheet,
        borderWidth: 1,
        borderColor: state === 'buy' ? 'rgba(212,175,55,0.4)' : garageTokens.surface.border,
        ...(highlight
          ? {
              borderColor: garageTokens.brand.base,
              shadowColor: garageTokens.brand.base,
              shadowOpacity: 0.55,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 0 },
            }
          : {}),
      })}
    >
      {/* Stall floor */}
      <View
        style={{ height: 116, position: 'relative', backgroundColor: garageTokens.paint.asphalt }}
      >
        {/* Asphalt grid texture + chevron entry hint */}
        <AsphaltGrid paint={paint} />

        {/* Painted U-rails: left, right, bottom */}
        <View
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            bottom: 10,
            width: 3,
            backgroundColor: paint,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: 10,
            top: 10,
            bottom: 10,
            width: 3,
            backgroundColor: paint,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10,
            height: 3,
            backgroundColor: paint,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />

        {/* Slot plate (top-left inside the stall) */}
        <View style={{ position: 'absolute', top: 14, left: 18 }}>
          <Text
            style={{
              color: paint,
              fontFamily: 'JetBrainsMono_400Regular',
              fontWeight: '600',
              fontSize: 11,
              letterSpacing: 1,
            }}
          >
            {slotPlate}
          </Text>
        </View>

        {/* Source tape (top-right) */}
        {tape ? (
          <View
            style={{
              position: 'absolute',
              top: 12,
              right: 14,
              paddingVertical: 2,
              paddingHorizontal: 7,
              borderRadius: 3,
              borderWidth: 1,
              borderStyle: state === 'buy' ? 'solid' : 'dashed',
              borderColor: paint,
              backgroundColor: tapeTint,
            }}
          >
            <Text style={{ color: paint, fontSize: 9, fontWeight: '700', letterSpacing: 1.4 }}>
              {tape}
            </Text>
          </View>
        ) : null}

        {/* Centre content per state */}
        {state === 'filled' && car ? (
          <View
            style={{
              position: 'absolute',
              left: 22,
              right: 22,
              top: 36,
              bottom: 18,
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: garageTokens.surface.border,
            }}
          >
            {car.photoUrl ? (
              <Image source={{ uri: car.photoUrl }} style={{ width: '100%', height: '100%' }} />
            ) : null}
          </View>
        ) : null}

        {state === 'empty' || state === 'buy' ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            pointerEvents="none"
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                borderWidth: 1.5,
                borderStyle: state === 'buy' ? 'solid' : 'dashed',
                borderColor: state === 'buy' ? garageTokens.brand.base : paint,
                backgroundColor:
                  state === 'buy' ? garageTokens.brand.tint : 'rgba(255,255,255,0.02)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: paint, fontSize: 22, lineHeight: 22 }}>+</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Metadata band */}
      <View
        style={{
          paddingTop: 10,
          paddingBottom: 12,
          paddingHorizontal: 14,
          backgroundColor: garageTokens.surface.deep,
          borderTopWidth: 1,
          borderTopColor: garageTokens.surface.border,
        }}
      >
        {state === 'filled' && car ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text
                style={{
                  flex: 1,
                  color: '#F5F5F5',
                  fontSize: 14,
                  fontWeight: '700',
                  letterSpacing: -0.1,
                }}
                numberOfLines={1}
              >
                {car.year} {car.make} {car.model}
              </Text>
              {car.isPremiumActive ? (
                <PremiumBadge
                  isPremiumActive
                  tier={premiumTier}
                  size="sm"
                  daysLeftUntilExpiry={daysLeftUntilExpiry}
                  {...(onBadgePress ? { onPress: onBadgePress } : {})}
                />
              ) : null}
            </View>
            {car.nickname ? (
              <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2 }}>{car.nickname}</Text>
            ) : null}
          </>
        ) : null}

        {state === 'empty' ? (
          <>
            <Text style={{ color: '#F5F5F5', fontSize: 14, fontWeight: '600' }}>
              Adicionar Carro
            </Text>
            <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2 }}>
              {subtitleFor(source)}
            </Text>
          </>
        ) : null}

        {state === 'buy' ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: '#F5F5F5', fontSize: 14, fontWeight: '700' }}>
                Comprar Vaga Adicional
              </Text>
              <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2 }}>
                Vaga extra para outro carro
              </Text>
            </View>
            {priceLabel ? (
              <Text style={{ color: '#F5F5F5', fontSize: 15, fontWeight: '700' }}>
                {priceLabel}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
