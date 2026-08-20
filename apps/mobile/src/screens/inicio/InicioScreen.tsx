// Tela de Início — ponto de entrada de /welcome.
//
// Duas variantes: a vitrine do não logado (GuestHome) e a home do membro
// (MemberHome, comportamento atual preservado). Enquanto a sessão não
// resolveu, nenhuma das duas renderiza: mostrar MemberHome e trocar por
// GuestHome logo depois causaria flicker no anônimo.
//
// A entrada da tela (fade mais translateY de 10px, 320ms) fica em cada
// variante, quando entrar. Não implementada nesta primeira versão.

import { StyleSheet, View } from 'react-native';

import { useAuth } from '~/auth/context';
import { GuestHome } from '~/screens/inicio/GuestHome';
import { MemberHome } from '~/screens/inicio/MemberHome';
import { p } from '~/screens/inicio/palette';

export default function InicioScreen() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <View style={styles.pending} testID="inicio-auth-pending" />;
  }

  return status === 'unauthenticated' ? <GuestHome /> : <MemberHome />;
}

const styles = StyleSheet.create({
  pending: { flex: 1, backgroundColor: p.bg },
});
