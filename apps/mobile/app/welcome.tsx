// A rota /welcome não muda: continua sendo a primeira tela do app, e segue em
// PUBLIC_EXACT em src/auth/redirect-intent.ts. O conteúdo mora em
// src/screens/inicio, no padrão das outras áreas do app.

import InicioScreen from '~/screens/inicio/InicioScreen';

export default function WelcomeRoute() {
  return <InicioScreen />;
}
