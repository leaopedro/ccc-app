// BuySpotSheet — quick-confirm sheet shown before navigating to /cart for the
// "buy extra spot" flow (plan §10.1 + correction §C10).
//
// Behavior contract (locked-contract impact):
//   - This sheet is the new entry point for the buy-spot stall card tap. The
//     Pix/Cartão CTAs still navigate to /cart in v1 — the in-context return
//     path (web-checkout return, deep-link handler, webhook → push) is
//     deferred per §C10.
//   - The sheet itself does NOT call addGarageSpotToCart. The host route owns
//     the cart-add + nav side effect via `onCheckoutPix` / `onCheckoutCard`.
//
// All user-facing strings route through `~/copy/garage` per CLAUDE.md i18n
// scaffold rule.

import { SheetShell, garageTokens } from '@jdm/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

type Props = {
  visible: boolean;
  priceLabel: string;
  onClose: () => void;
  onCheckoutPix: () => void;
  onCheckoutCard: () => void;
  submitting?: boolean;
};

export function BuySpotSheet({
  visible,
  priceLabel,
  onClose,
  onCheckoutPix,
  onCheckoutCard,
  submitting,
}: Props) {
  const copy = garageCopy.garage;
  const isSubmitting = submitting === true;
  const bullets = [
    copy.buySpotBulletOneTime,
    copy.buySpotBulletAvailability,
    copy.buySpotBulletAutoReturn,
  ];
  // Defense in depth: the Pressable `disabled` prop already blocks taps on
  // RN, but a synchronous in-closure guard means a CTA can never fire while
  // `submitting` is true regardless of how the underlying primitive honours
  // disabled (e.g. test mocks that bypass it).
  const handlePix = () => {
    if (isSubmitting) return;
    onCheckoutPix();
  };
  const handleCard = () => {
    if (isSubmitting) return;
    onCheckoutCard();
  };
  return (
    <SheetShell
      visible={visible}
      title={copy.buySpotSheetTitle}
      onClose={onClose}
      closeLabel={copy.closeA11yLabel}
    >
      <View style={styles.body}>
        <View style={styles.itemRow}>
          <View style={styles.itemGlyph} />
          <View style={styles.flex}>
            <Text style={styles.itemTitle}>{copy.buySpotItemTitle}</Text>
            <Text style={styles.itemSub}>{copy.buySpotItemSub}</Text>
          </View>
          <Text style={styles.itemPrice}>{priceLabel}</Text>
        </View>

        {bullets.map((line) => (
          <View key={line} style={styles.bullet}>
            <Text style={styles.bulletDot}>✓</Text>
            <Text style={styles.bulletText}>{line}</Text>
          </View>
        ))}

        <View style={styles.ctas}>
          <Pressable
            onPress={handlePix}
            disabled={isSubmitting}
            style={styles.ctaPix}
            accessibilityRole="button"
            accessibilityLabel={copy.buySpotCtaPixA11y}
            accessibilityState={{ disabled: isSubmitting }}
          >
            <Text style={styles.ctaPixLabel}>{copy.buySpotCtaPix}</Text>
          </Pressable>
          <Pressable
            onPress={handleCard}
            disabled={isSubmitting}
            style={styles.ctaCard}
            accessibilityRole="button"
            accessibilityLabel={copy.buySpotCtaCardA11y}
            accessibilityState={{ disabled: isSubmitting }}
          >
            <Text style={styles.ctaCardLabel}>{copy.buySpotCtaCard}</Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>{copy.buySpotDisclaimer}</Text>
      </View>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: garageTokens.surface.deep,
    borderWidth: 1,
    borderColor: garageTokens.surface.border,
    gap: 12,
    marginBottom: 4,
  },
  itemGlyph: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: garageTokens.brand.tint,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  itemTitle: { color: '#F5F5F5', fontSize: 14, fontWeight: '700' },
  itemSub: { color: '#8A8A93', fontSize: 12, marginTop: 2 },
  itemPrice: { color: '#F5F5F5', fontSize: 15, fontWeight: '700' },
  flex: { flex: 1 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { color: '#5DE08A', fontSize: 13 },
  bulletText: { flex: 1, color: '#C9C9CD', fontSize: 12, lineHeight: 17 },
  ctas: { flexDirection: 'row', gap: 8, marginTop: 6 },
  ctaPix: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: garageTokens.brand.base,
    alignItems: 'center',
  },
  ctaPixLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  ctaCard: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: garageTokens.surface.alt,
    borderWidth: 1,
    borderColor: garageTokens.surface.borderStrong,
    alignItems: 'center',
  },
  ctaCardLabel: { color: '#F5F5F5', fontSize: 13, fontWeight: '700' },
  disclaimer: { color: '#8A8A93', fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 16 },
});
