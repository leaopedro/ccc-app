import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { garageTokens, type GarageRarity } from './garage-tokens.js';
import { HexBadge } from './HexBadge.js';

const MAX_VISIBLE = 6;

// Grace period before the backdrop becomes pressable. A tap already in
// flight when the overlay springs in must not consume a celebration the
// user never read — that ack is permanent. `reduceMotion` skips it: there is
// no entrance animation to protect a tap from.
const BACKDROP_GRACE_MS = 400;

export interface BadgeCelebrationEntry {
  code: string;
  title: string;
  description: string;
  rarity: GarageRarity;
  icon: string;
}

export interface BadgeCelebrationCopy {
  titleOne: string;
  /** Function of the count — word order changes between pt-BR and en. */
  titleMany: (count: number) => string;
  close: string;
  /** Function of the overflow count (e.g. "+4"). */
  more: (count: number) => string;
}

export interface BadgeCelebrationProps {
  entries: BadgeCelebrationEntry[];
  copy: BadgeCelebrationCopy;
  onClose: () => void;
  /** OS accessibility setting, not a product preference: content appears
   *  already in place, no spring, no stagger. */
  reduceMotion?: boolean;
  /** `insets.bottom` from the consumer. `packages/ui` does not import
   *  safe-area-context; the caller knows the inset. */
  insetBottom?: number;
  testID?: string;
}

/**
 * BadgeCelebration — full-screen celebration overlay shown when the member
 * earns one or more badges. Pure presentation: controlled component, no
 * fetching, no copy of its own, no `visible` prop — it renders whenever
 * mounted and the parent decides when that is.
 *
 * Rendered inside a React Native `Modal` (mirrors `SheetShell.tsx`), never a
 * plain `View` — a `Modal` is a separate native window, so a sibling `View`
 * next to the tab navigator would render behind every other sheet in the
 * app (`BadgesSheet`, `BuySpotSheet`, `EditGarageSheet`, `CoverPickerSheet`,
 * the marketing-consent modal).
 */
export const BadgeCelebration = ({
  entries,
  copy,
  onClose,
  reduceMotion = false,
  insetBottom = 0,
  testID,
}: BadgeCelebrationProps) => {
  const single = entries.length === 1;
  const visible = entries.slice(0, MAX_VISIBLE);
  const rest = entries.length - visible.length;

  const backdrop = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(reduceMotion ? 0 : 40)).current;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.85)).current;

  const [backdropDismissable, setBackdropDismissable] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [reduceMotion, backdrop, rise, scale]);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setTimeout(() => setBackdropDismissable(true), BACKDROP_GRACE_MS);
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  useEffect(() => {
    // Mirrors what a sighted user sees at the top of the overlay the moment
    // it appears.
    AccessibilityInfo.announceForAccessibility(
      single ? copy.titleOne : copy.titleMany(entries.length),
    );
  }, [single, copy, entries.length]);

  return (
    <Modal transparent animationType="none" visible onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <Pressable
          testID="celebration-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={backdropDismissable ? onClose : undefined}
          disabled={!backdropDismissable}
          accessible={false}
        />
        <Animated.View
          accessibilityViewIsModal
          testID={testID ?? 'celebration'}
          style={[styles.card, { transform: [{ translateY: rise }, { scale }] }]}
        >
          <View style={single ? styles.hexSingle : styles.hexRow}>
            {visible.map((e, i) => (
              <View
                key={`${e.code}-${i}`}
                testID={`celebration-hex-${e.code}`}
                accessible
                accessibilityLabel={e.title}
              >
                <HexBadge
                  code={e.code}
                  variant="earned"
                  rarity={e.rarity}
                  icon={e.icon}
                  size={single ? 'lg' : 'md'}
                />
              </View>
            ))}
            {rest > 0 ? <Text style={styles.more}>{copy.more(rest)}</Text> : null}
          </View>

          <Text style={styles.title}>{single ? copy.titleOne : copy.titleMany(entries.length)}</Text>

          {single ? (
            <>
              <Text style={styles.badgeTitle}>{entries[0]!.title}</Text>
              <Text style={styles.badgeDescription}>{entries[0]!.description}</Text>
            </>
          ) : (
            visible.map((e, i) => (
              <Text
                key={`${e.code}-${i}`}
                testID="celebration-badge-title"
                style={styles.badgeTitle}
              >
                {e.title}
              </Text>
            ))
          )}

          <Pressable
            testID="celebration-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={copy.close}
            style={[styles.close, { paddingBottom: 14 + insetBottom }]}
          >
            <Text style={styles.closeLabel}>{copy.close}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    backgroundColor: garageTokens.surface.sheet,
    borderWidth: 1,
    borderColor: garageTokens.surface.border,
    borderRadius: 20,
    paddingTop: 28,
    paddingHorizontal: 20,
  },
  hexSingle: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  hexRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  more: {
    color: '#8A8A93',
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    color: garageTokens.brand.base,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  badgeTitle: {
    color: '#F5F5F5',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  badgeDescription: {
    color: '#C9C9CD',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  close: {
    width: '100%',
    marginTop: 16,
    paddingTop: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: garageTokens.surface.alt,
    borderWidth: 1,
    borderColor: garageTokens.surface.border,
    marginBottom: 20,
  },
  closeLabel: {
    color: '#F5F5F5',
    fontSize: 14,
    fontWeight: '700',
  },
});
