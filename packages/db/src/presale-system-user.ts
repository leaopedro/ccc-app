import { prisma } from './index.js';

// Formulário público não pode criar nem tocar linhas de User por email: abriria
// bloqueio de cadastro em massa (routes/auth/signup.ts), conta semeada por
// terceiro (routes/auth/reset-password.ts) e consentimento forjado permanente
// (services/consent.ts). Todo pedido de convidado da pré-venda pende de UMA
// linha de User criada por seed, nunca por request. O email real do comprador
// vive só em PresaleGuest.
//
// Domínio próprio, não roteável: não é um endereço que alguém digita ou recebe
// email de verdade.
export const PRESALE_SYSTEM_USER_EMAIL = 'presale-system@casacar.club.internal';

/**
 * Garante a existência do usuário-sistema da pré-venda e devolve o id.
 * `status: 'disabled'` é load-bearing: INACTIVE_USER_STATUSES
 * (packages/shared/src/auth.ts) trata `disabled` como inativo, checado em
 * login.ts, refresh.ts, mfa-verify.ts, forgot-password.ts e plugins/auth.ts.
 * É isso que garante que esta linha nunca autentica.
 */
export const ensurePresaleSystemUser = async (): Promise<string> => {
  try {
    const user = await prisma.user.upsert({
      where: { email: PRESALE_SYSTEM_USER_EMAIL },
      update: {},
      create: {
        email: PRESALE_SYSTEM_USER_EMAIL,
        name: 'Casa In Box (convidado)',
        passwordHash: null,
        role: 'user',
        status: 'disabled',
      },
    });
    return user.id;
  } catch (err) {
    // `upsert` com `update: {}` NÃO vira `INSERT ... ON CONFLICT` no Prisma:
    // ele cai no caminho find-then-create, que é uma leitura seguida de uma
    // escrita sem lock. Dois checkouts de convidado chegando juntos na
    // primeira vez (a linha ainda não existe) leem "não existe" os dois,
    // inserem os dois, e o perdedor toma P2002 em `email` — que subia até a
    // rota e virava 500 no POST do checkout. Reproduzido na suíte completa da
    // Task 7, em `clique duplo com o mesmo clientRequestId`.
    //
    // Mesmo tratamento que ensurePresaleSettings
    // (apps/api/src/services/presale/settings.ts) já dá ao mesmo problema:
    // perdeu a corrida, lê a linha que o vencedor acabou de criar.
    const code = (err as { code?: unknown }).code;
    if (code !== 'P2002') throw err;
    const winner = await prisma.user.findUniqueOrThrow({
      where: { email: PRESALE_SYSTEM_USER_EMAIL },
      select: { id: true },
    });
    return winner.id;
  }
};
