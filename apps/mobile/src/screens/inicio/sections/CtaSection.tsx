// Seções 3 e 4 — criar conta e assinar.
//
// "Criar conta" é o CTA principal, em gradiente dourado. "Assinar" é o
// secundário de destaque, contornado. A decisão de para onde cada um navega
// (e do desvio pelo login quando anônimo) fica no GuestHome, não aqui: esta
// seção só dispara os callbacks.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { GoldPill } from '~/screens/inicio/components/GoldPill';
import { p } from '~/screens/inicio/palette';

export function CtaSection({
  onCreateAccount,
  onSubscribe,
}: {
  onCreateAccount: () => void;
  onSubscribe: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <GoldPill
          label={inicioCopy.cta.signup}
          onPress={onCreateAccount}
          testID="inicio-cta-signup"
        />
        <Text style={styles.hint}>{inicioCopy.cta.signupHint}</Text>
      </View>

      <View style={styles.block}>
        <Pressable
          onPress={onSubscribe}
          accessibilityRole="button"
          accessibilityLabel={inicioCopy.cta.subscribe}
          testID="inicio-cta-subscribe"
          style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
        >
          <Text style={styles.secondaryLabel}>{inicioCopy.cta.subscribe}</Text>
        </Pressable>
        <Text style={styles.hint}>{inicioCopy.cta.subscribeHint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  block: { gap: 8 },
  secondary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: p.gold,
    backgroundColor: 'transparent',
  },
  pressed: { opacity: 0.85 },
  secondaryLabel: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.gold,
    textTransform: 'uppercase',
  },
  hint: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted50,
    textAlign: 'center',
  },
});
