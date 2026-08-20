// Saudacao do membro, conforme o handoff.
//
// Sem primeiro nome, cai na saudacao generica em vez de renderizar uma virgula
// solta. Sem createdAt valido, a segunda linha nao renderiza.

import { StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatMemberSince } from '~/screens/inicio/format-member';
import { p } from '~/screens/inicio/palette';

export function MemberGreeting({
  firstName,
  createdAt,
}: {
  firstName: string | null;
  createdAt: string | null;
}) {
  const since = createdAt ? formatMemberSince(createdAt) : '';
  const greeting = firstName
    ? inicioCopy.member.greeting(firstName)
    : inicioCopy.member.greetingFallback;

  return (
    <View style={styles.wrap}>
      <Text style={styles.greeting} accessibilityRole="header">
        {greeting}
      </Text>
      {since ? <Text style={styles.since}>{inicioCopy.member.memberSince(since)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  greeting: {
    fontFamily: 'Jost_700Bold',
    fontSize: 19,
    letterSpacing: 0.19,
    color: p.cream,
  },
  since: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 2.9,
    color: p.muted45,
  },
});
