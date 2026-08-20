// /welcome virou alias historico. A tela agora mora na aba /inicio, dentro do
// grupo (app), para ter estado ativo na tab bar. Este redirect existe para nao
// quebrar deep link antigo nem `next=/welcome` ja persistido.

import { Redirect } from 'expo-router';

export default function WelcomeRoute() {
  return <Redirect href="/inicio" />;
}
