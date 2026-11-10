// Prova de corrida do usuário-sistema da pré-venda
// (packages/db/src/presale-system-user.ts). Arquivo próprio, com o beforeEach
// mais magro possível de propósito: encontrado pela suíte completa da Task 7,
// o bug só abre quando as chamadas concorrentes chegam juntas de verdade, e
// qualquer trabalho extra antes delas (criar produto, subir o Fastify) as
// escalona o bastante para a janela fechar.
import { ensurePresaleSystemUser, PRESALE_SYSTEM_USER_EMAIL, prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

describe('ensurePresaleSystemUser', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('devolve sempre o mesmo id e nunca duplica a linha', async () => {
    const first = await ensurePresaleSystemUser();
    const second = await ensurePresaleSystemUser();

    expect(second).toBe(first);
    await expect(prisma.user.count({ where: { email: PRESALE_SYSTEM_USER_EMAIL } })).resolves.toBe(
      1,
    );
  });

  it('aguenta chamadas concorrentes com a linha ainda inexistente', async () => {
    // `upsert` com `update: {}` NÃO vira `INSERT ... ON CONFLICT` no Prisma:
    // cai em find-then-create, uma leitura seguida de escrita sem lock. Sem o
    // tratamento de P2002, as perdedoras estouravam `User.email` e o erro
    // subia até a rota de checkout como 500.
    const ids = await Promise.all(Array.from({ length: 8 }, () => ensurePresaleSystemUser()));

    expect(new Set(ids).size).toBe(1);
    await expect(prisma.user.count({ where: { email: PRESALE_SYSTEM_USER_EMAIL } })).resolves.toBe(
      1,
    );
  });

  it('mantém o usuário-sistema incapaz de autenticar', async () => {
    await ensurePresaleSystemUser();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: PRESALE_SYSTEM_USER_EMAIL },
    });
    expect(user.status).toBe('disabled');
    expect(user.passwordHash).toBeNull();
  });
});
