// IdentityCard — the title card that overlays the garage cover (plan §8.2).
//
// Owns: glyph/title/slug/badge row, optional description, and the action pill
// row (CAR count + visibility pill + Cover/Edit/Share buttons for owners).
// All user-facing strings route through `~/copy/garage` per CLAUDE.md i18n
// scaffold rule.

import { brand } from '@ccc/design';
import { type GarageOwner } from '@ccc/shared/garage';
import { PremiumBadge } from '@ccc/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

type Props = {
  garage: GarageOwner;
  carCount: number;
  isOwner: boolean;
  onEdit?: () => void;
  onCoverEdit?: () => void;
  onShare?: () => void;
  onBadgePress?: () => void;
};

export function IdentityCard({
  garage,
  carCount,
  isOwner,
  onEdit,
  onCoverEdit,
  onShare,
  onBadgePress,
}: Props) {
  return (
    <View style={styles.card}>
      {garage.isPremiumActive ? <View style={styles.accentLine} /> : null}

      <View style={styles.topRow}>
        <View style={styles.glyph}>
          <Text style={styles.glyphChar}>{garage.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.titleColumn}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {garage.name}
            </Text>
            {isOwner ? <Text style={styles.pencilGlyph}>✎</Text> : null}
            {garage.isPremiumActive ? (
              <PremiumBadge
                isPremiumActive
                tier={garage.premiumTier}
                daysLeftUntilExpiry={garage.daysLeftUntilExpiry}
                size="sm"
                {...(onBadgePress ? { onPress: onBadgePress } : {})}
              />
            ) : null}
          </View>
          <Text style={styles.slug}>
            {garage.isPublic ? '🌐 ' : '🔒 '}
            {garageCopy.garage.slugUrlPrefix}
            {garage.slug}
          </Text>
        </View>
      </View>

      {garage.description ? <Text style={styles.description}>{garage.description}</Text> : null}

      <View style={styles.actionRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>
            {carCount} {garageCopy.garage.carCountLabel(carCount)}
          </Text>
        </View>
        <View style={[styles.pill, garage.isPublic ? styles.pillSuccess : styles.pillNeutral]}>
          <Text
            style={[
              styles.pillText,
              garage.isPublic ? styles.pillTextSuccess : styles.pillTextNeutral,
            ]}
          >
            {garage.isPublic
              ? garageCopy.garage.visibilityPublicShort
              : garageCopy.garage.visibilityPrivateShort}
          </Text>
        </View>

        <View style={styles.flex} />

        {isOwner ? (
          <>
            {onCoverEdit ? (
              <Pressable
                onPress={onCoverEdit}
                accessibilityRole="button"
                accessibilityLabel={garageCopy.garage.coverButtonA11yLabel}
                style={styles.outlineBtn}
              >
                <Text style={styles.outlineBtnLabel}>{garageCopy.garage.actionCoverLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onEdit} accessibilityRole="button" style={styles.fillBtn}>
              <Text style={styles.fillBtnLabel}>{garageCopy.garage.actionEditLabel}</Text>
            </Pressable>
          </>
        ) : null}

        {garage.isPublic ? (
          <Pressable onPress={onShare} accessibilityRole="button" style={styles.brandBtn}>
            <Text style={styles.brandBtnLabel}>
              {isOwner
                ? garageCopy.garage.actionShareLinkLabel
                : garageCopy.garage.actionShareLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: -44,
    marginHorizontal: 16,
    position: 'relative',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 12 },
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: brand.color.brand,
    borderRadius: 2,
  },
  topRow: { flexDirection: 'row', gap: 12 },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphChar: { color: '#C9C9CD', fontSize: 20, fontWeight: '700' },
  titleColumn: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { color: '#F5F5F5', fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 22 },
  pencilGlyph: { color: '#8A8A93', fontSize: 13 },
  slug: { color: '#8A8A93', fontSize: 11.5, marginTop: 3, fontFamily: 'JetBrainsMono_400Regular' },
  description: { marginTop: 10, color: '#C9C9CD', fontSize: 13, lineHeight: 19 },
  actionRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#1F1F1F',
    justifyContent: 'center',
  },
  pillText: {
    color: '#C9C9CD',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  pillSuccess: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)' },
  pillTextSuccess: { color: '#5DE08A' },
  pillNeutral: {},
  pillTextNeutral: {},
  flex: { flex: 1 },
  outlineBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  outlineBtnLabel: { color: '#C9C9CD', fontSize: 12, fontWeight: '600' },
  fillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  fillBtnLabel: { color: '#F5F5F5', fontSize: 12, fontWeight: '600' },
  brandBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: brand.color.brand,
  },
  brandBtnLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
