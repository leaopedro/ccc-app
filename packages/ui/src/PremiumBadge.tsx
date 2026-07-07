import { Pressable, Text, View } from 'react-native';

import { tierColors, type GaragePremiumTier } from './garage-tokens.js';

export interface PremiumBadgeProps {
  isPremiumActive: boolean | null | undefined;
  tier?: GaragePremiumTier | null;
  size?: 'sm' | 'md';
  daysLeftUntilExpiry?: number | null;
  onPress?: () => void;
  nearExpiryA11yLabel?: (days: number) => string;
}

const heightFor = (size: 'sm' | 'md') => (size === 'md' ? 28 : 24);
const fontSizeFor = (size: 'sm' | 'md') => (size === 'md' ? 11 : 10);
const tierName = (tier: GaragePremiumTier | null | undefined): string => {
  if (tier === 'gold') return 'Gold';
  if (tier === 'silver') return 'Silver';
  if (tier === 'bronze') return 'Bronze';
  return 'Premium';
};

export function PremiumBadge({
  isPremiumActive,
  tier = null,
  size = 'sm',
  daysLeftUntilExpiry = null,
  onPress,
  nearExpiryA11yLabel,
}: PremiumBadgeProps) {
  if (isPremiumActive !== true) return null;

  const t = tierColors(tier);
  const h = heightFor(size);
  const fs = fontSizeFor(size);
  const showDays =
    daysLeftUntilExpiry !== null && daysLeftUntilExpiry > 0 && daysLeftUntilExpiry <= 7;
  const nearExpirySuffix = showDays
    ? `, ${nearExpiryA11yLabel ? nearExpiryA11yLabel(daysLeftUntilExpiry ?? 0) : `expira em ${daysLeftUntilExpiry} dias`}`
    : '';
  const a11yLabel = `${t.label}${nearExpirySuffix}`;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        height: h,
        borderRadius: 6,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: `${t.main}66`,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 7,
          backgroundColor: t.main,
        }}
      >
        <Text
          style={{
            color: '#0A0A0A',
            fontSize: fs,
            fontWeight: '700',
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          {tierName(tier)}
        </Text>
      </View>
      {showDays ? (
        <View style={{ paddingHorizontal: 7, justifyContent: 'center' }}>
          <Text
            style={{
              color: t.main,
              fontSize: fs,
              fontWeight: '700',
              fontVariant: ['tabular-nums'],
            }}
          >
            {daysLeftUntilExpiry}d
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return <View accessibilityLabel={a11yLabel}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      {content}
    </Pressable>
  );
}
