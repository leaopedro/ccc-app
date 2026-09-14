import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
//
// Busca a partir da raiz do monorepo, em `apps/` e `packages/`: um handler
// registrado em qualquer app, ou num pacote compartilhado usado por eles,
// quebra o mesmo requisito. Restringir a `apps/mobile/{app,src}` deixaria
// passar um `setNotificationHandler` adicionado num pacote de `packages/`.
const findRepoRoot = (start: string): string => {
  let dir = start;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml not found above ${start}`);
    }
    dir = parent;
  }
  return dir;
};

describe('supressao de banner em foreground', () => {
  it('nao existe setNotificationHandler em apps/ ou packages/', () => {
    const repoRoot = findRepoRoot(process.cwd());
    let out = '';
    try {
      out = execFileSync(
        'grep',
        [
          '-rl',
          'setNotificationHandler',
          'apps',
          'packages',
          '--include=*.ts',
          '--include=*.tsx',
          '--exclude-dir=node_modules',
          '--exclude-dir=dist',
          '--exclude-dir=build',
          '--exclude-dir=.next',
          '--exclude-dir=.expo',
          '--exclude-dir=coverage',
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch {
      // grep sai com 1 quando não acha nada. É o caminho de sucesso.
      out = '';
    }
    const hits = out.split('\n').filter((l) => l.length > 0 && !l.includes('__tests__'));
    expect(hits).toEqual([]);
  });
});
