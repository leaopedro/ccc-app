// Aba Início. Primeira da tab bar.
//
// Fica dentro do grupo (app) para ser irmã das outras abas: estado ativo,
// historico e comportamento de voltar iguais aos demais. O grupo nao tem gate
// de autenticacao, so CartProvider e Tabs, entao o anonimo tambem entra aqui e
// ve a vitrine.

import InicioScreen from '~/screens/inicio/InicioScreen';

export default function InicioTabRoute() {
  return <InicioScreen />;
}
