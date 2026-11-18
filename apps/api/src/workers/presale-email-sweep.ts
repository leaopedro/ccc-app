/**
 * Varredura de emails perdidos da pré-venda Casa In Box.
 *
 * Achado B (revisão cruzada, finding-b.md): `confirmation-email.ts` e
 * `pix-code-email.ts` carimbam ANTES de enviar e SOLTAM o carimbo se o
 * mailer falhar — de propósito, para que uma falha transitória não vire
 * perda definitiva. Mas soltar só ajuda se algo chamar a função de novo, e
 * nada chamava: o handler do webhook devolve 200 e engole o erro de envio,
 * então o provedor nunca reentrega. Sem concorrência nenhuma o email já se
 * perdia para sempre; sob concorrência o segundo chamador lê o CAS falho
 * como "já enviado" e desiste antes do primeiro sequer falhar.
 *
 * O conserto não mexe no carimbo-antes-do-envio (ele é o que fecha a
 * corrida de envio duplo) nem reabre enviar-depois-carimbar. Esta varredura
 * é o "alguém chama de novo" que faltava: descobre, depois, que um email
 * devia ter saído e não saiu, e tenta de novo pelas MESMAS funções
 * (`sendPresaleConfirmationEmail` / `sendPresalePixCodeEmail`), cujo próprio
 * compare-and-set garante que esta varredura nunca manda em duplicata.
 *
 * Mesmo molde dos workers vizinhos (pix-reconcile.ts, order-expiry.ts):
 * teto de varredura (QUERY_LIMIT), carência contra o envio em voo
 * (GRACE_MS) e alerta se a fila crescer.
 *
 * A varredura só lê e envia. Nunca muda o status de um pedido.
 */
import { prisma } from '@ccc/db';
import * as Sentry from '@sentry/node';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import type { Mailer } from '../services/mailer/index.js';
import { sendPresaleConfirmationEmail } from '../services/presale/confirmation-email.js';
import { sendPresalePixCodeEmail } from '../services/presale/pix-code-email.js';

export type PresaleEmailSweepTickDeps = {
  mailer: Mailer;
  env: Env;
  alertDepth: number;
  now?: Date;
  log?: FastifyBaseLogger;
};

/** Teto por consulta. Mesmo formato do QUERY_LIMIT dos workers vizinhos. */
const QUERY_LIMIT = 200;

/**
 * Carência. O envio original (webhook de pagamento, para a confirmação; o
 * próprio checkout, para o código Pix) roda dentro do mesmo request que
 * carimba a coluna, e o `await mailer.send(...)` dele ainda está em voo
 * quando a varredura tickar se ela não esperar nada. Sem essa espera a
 * varredura reabriria a MESMA corrida de envio duplo que o carimbo-antes-
 * do-envio existe para fechar: ela veria `<col>SentAt: null`, mandaria o
 * email, e o envio original (que ainda não tinha falhado) completaria
 * depois — dois emails para o mesmo pedido.
 *
 * Mesmo raciocínio do `GRACE_MS` de pix-reconcile.ts, aplicado aqui: o valor
 * só precisa ser maior que a chamada de rede mais lenta plausível ao
 * mailer (segundos, não minutos — nem o SDK da Resend nem o handler do
 * webhook mantêm esse `await` pendurado por muito tempo) e continua
 * pequeno frente às janelas que esta varredura existe para cobrir: o
 * código Pix vive só 1 hora, e o pedido pago fica com o carimbo em aberto
 * indefinidamente até alguém notar. 5 minutos dá uma folga generosa sem
 * atrasar de forma perceptível a recuperação de um email realmente
 * perdido.
 */
const GRACE_MS = 5 * 60_000;

/**
 * `deps.log` é opcional neste worker (mesmo formato de pix-reconcile.ts),
 * mas `sendPresaleConfirmationEmail`/`sendPresalePixCodeEmail` chamam
 * `deps.log.error`/`.warn` direto, sem optional chaining.
 */
const silentLog = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const alertIfSaturated = (
  kind: 'confirmation' | 'pix_code',
  depth: number,
  alertDepth: number,
  log?: FastifyBaseLogger,
): void => {
  if (depth < alertDepth) return;

  const saturated = depth >= QUERY_LIMIT;
  log?.warn(
    {
      kind: `presale-email-sweep.queue_depth_alert.${kind}`,
      depth,
      alertDepth,
      queryLimit: QUERY_LIMIT,
      saturated,
    },
    'presale-email-sweep: fila de email pendente em ou acima do limiar de alerta',
  );
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'presale-email-sweep-queue-depth');
    scope.setTag('email_kind', kind);
    scope.setLevel(saturated ? 'error' : 'warning');
    scope.setExtras({ depth, alertDepth, queryLimit: QUERY_LIMIT });
    Sentry.captureMessage(
      saturated
        ? `presale-email-sweep: janela saturada para ${kind}, linhas estão sendo descartadas`
        : `presale-email-sweep: fila de ${kind} acima do limiar de alerta`,
      saturated ? 'error' : 'warning',
    );
  });
};

export const runPresaleEmailSweepTick = async (deps: PresaleEmailSweepTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const log = deps.log;
  const graceCutoff = new Date(now.getTime() - GRACE_MS);

  // Confirmação: pedido pago, de pré-venda, liquidado há mais que a
  // carência, sem o carimbo de confirmação enviado.
  const missingConfirmation = await prisma.order.findMany({
    where: {
      origin: 'casa_in_box',
      status: 'paid',
      confirmationEmailSentAt: null,
      paidAt: { not: null, lt: graceCutoff },
    },
    orderBy: { paidAt: 'asc' },
    take: QUERY_LIMIT,
    select: { id: true },
  });

  alertIfSaturated('confirmation', missingConfirmation.length, deps.alertDepth, log);

  for (const row of missingConfirmation) {
    try {
      await sendPresaleConfirmationEmail(row.id, {
        mailer: deps.mailer,
        env: deps.env,
        log: log ?? silentLog,
      });
    } catch (err) {
      Sentry.captureException(err, {
        extra: { orderId: row.id, worker: 'presale-email-sweep', email: 'confirmation' },
      });
      log?.error(
        { err, orderId: row.id },
        'presale-email-sweep: falha ao reenviar confirmação, seguindo para o próximo',
      );
    }
  }

  // Código Pix: pedido de pré-venda ainda pagável (brCode gravado, código
  // ainda vivo), criado há mais que a carência, sem o carimbo do código
  // enviado.
  const missingPixCode = await prisma.order.findMany({
    where: {
      origin: 'casa_in_box',
      pixCodeEmailSentAt: null,
      brCode: { not: null },
      expiresAt: { not: null, gt: now },
      createdAt: { lt: graceCutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: QUERY_LIMIT,
    select: { id: true },
  });

  alertIfSaturated('pix_code', missingPixCode.length, deps.alertDepth, log);

  for (const row of missingPixCode) {
    try {
      await sendPresalePixCodeEmail(row.id, {
        mailer: deps.mailer,
        env: deps.env,
        log: log ?? silentLog,
      });
    } catch (err) {
      Sentry.captureException(err, {
        extra: { orderId: row.id, worker: 'presale-email-sweep', email: 'pix_code' },
      });
      log?.error(
        { err, orderId: row.id },
        'presale-email-sweep: falha ao reenviar código Pix, seguindo para o próximo',
      );
    }
  }
};

export const startPresaleEmailSweepWorker = (deps: {
  mailer: Mailer;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  // A cada minuto, mesma cadência de pix-reconcile.ts e order-expiry.ts: o
  // código Pix vive só 1 hora, então mais chances por minuto importam aqui
  // do mesmo jeito que importam lá.
  const task = cron.schedule('* * * * *', () => {
    void runPresaleEmailSweepTick({
      mailer: deps.mailer,
      env: deps.env,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'presale-email-sweep tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
