import { Text, View } from 'react-native';

import { SheetShell } from './SheetShell.js';
import { garageTokens, tierColors, type GaragePremiumTier } from './garage-tokens.js';

export interface PremiumSheetProps {
  visible: boolean;
  tier: GaragePremiumTier | null;
  isPremiumActive: boolean;
  daysLeftUntilExpiry: number | null;
  onClose: () => void;
  copy: {
    title: string;
    tierLabel: string; // 'GOLD TIER'
    heroTitle: string; // 'CCC Gold'
    heroBody: string;
    nearExpiry: (n: number) => string; // 'Expira em 3 dias · Renove …'
    benefits: ReadonlyArray<{ title: string; sub: string }>;
    footer: string; // 'Premium nunca limita …'
    closeA11yLabel?: string;
  };
}

export function PremiumSheet({
  visible,
  tier,
  isPremiumActive,
  daysLeftUntilExpiry,
  onClose,
  copy,
}: PremiumSheetProps) {
  const t = tierColors(tier);
  const showNearExpiry =
    isPremiumActive &&
    daysLeftUntilExpiry !== null &&
    daysLeftUntilExpiry > 0 &&
    daysLeftUntilExpiry <= 7;

  return (
    <SheetShell
      visible={visible}
      title={copy.title}
      onClose={onClose}
      testID="premium-sheet"
      {...(copy.closeA11yLabel !== undefined ? { closeLabel: copy.closeA11yLabel } : {})}
    >
      <View style={{ padding: 16 }}>
        <View
          style={{
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
            borderWidth: 1,
            borderColor: `${t.main}44`,
            backgroundColor: t.tint,
          }}
        >
          <Text
            style={{
              color: t.main,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1.6,
              textTransform: 'uppercase',
            }}
          >
            {copy.tierLabel}
          </Text>
          <Text
            style={{
              marginTop: 6,
              color: '#F5F5F5',
              fontSize: 28,
              lineHeight: 30,
              fontWeight: '800',
              letterSpacing: -0.5,
            }}
          >
            {copy.heroTitle}
          </Text>
          <Text
            style={{
              marginTop: 6,
              color: '#C9C9CD',
              fontSize: 12.5,
              lineHeight: 18,
            }}
          >
            {copy.heroBody}
          </Text>

          {showNearExpiry ? (
            <View
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.35)',
                backgroundColor: 'rgba(245,158,11,0.10)',
              }}
            >
              <Text style={{ color: '#FFC04A', fontSize: 12 }}>
                {copy.nearExpiry(daysLeftUntilExpiry ?? 0)}
              </Text>
            </View>
          ) : null}
        </View>

        {copy.benefits.map((b) => (
          <View
            key={b.title}
            style={{
              flexDirection: 'row',
              gap: 12,
              padding: 12,
              borderRadius: 12,
              marginBottom: 10,
              backgroundColor: garageTokens.surface.deep,
              borderWidth: 1,
              borderColor: garageTokens.surface.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#F5F5F5', fontSize: 13, fontWeight: '700' }}>{b.title}</Text>
              <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2, lineHeight: 17 }}>
                {b.sub}
              </Text>
            </View>
          </View>
        ))}

        <View
          style={{
            marginTop: 4,
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: garageTokens.surface.border,
          }}
        >
          <Text style={{ color: '#8A8A93', fontSize: 11.5, lineHeight: 17 }}>{copy.footer}</Text>
        </View>
      </View>
    </SheetShell>
  );
}
