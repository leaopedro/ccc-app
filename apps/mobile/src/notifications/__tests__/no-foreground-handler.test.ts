import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// "Sem push com o app aberto" é o requisito que o usuário pediu nos dois
// ramos, e hoje ele é satisfeito por AUSÊNCIA de código: o app não registra
// setNotificationHandler, e o default do expo-notifications é não apresentar a
// notificação em foreground (documentado na fonte do pacote, em
// NotificationsHandler.ts). Uma linha de código nova quebra isso em silêncio.
//
// Este teste afirma que NÃO EXISTE handler, não que o handler tem tal campo.
// Uma versão anterior do plano afirmava "nenhum handler com
// shouldShowAlert: true": nessa versão do pacote esse campo é deprecado em
// favor de shouldShowBanner/shouldShowList, e o exemplo da própria doc usa
// shouldShowBanner. Quem adicionasse um handler copiando a doc passaria pelo
// teste e quebraria o requisito.
describe('supressao de banner em foreground', () => {
  it('nao existe setNotificationHandler no app', () => {
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rl', 'setNotificationHandler', 'app', 'src', '--include=*.ts', '--include=*.tsx'],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
    } catch {
      // grep sai com 1 quando não acha nada. É o caminho de sucesso.
      out = '';
    }
    const hits = out.split('\n').filter((l) => l.length > 0 && !l.includes('__tests__'));
    expect(hits).toEqual([]);
  });
});
