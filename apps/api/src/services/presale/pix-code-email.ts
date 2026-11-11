/**
 * Envio do email com o código Pix da pré-venda Casa In Box.
 *
 * O comprador sai da tela para pagar no banco; se fechar a aba antes de
 * copiar o código, a venda morre. Este email é o motivo do produto ter
 * pedido uma janela de uma hora em vez dos quinze minutos de sempre: dá
 * tempo do comprador achar o email e voltar pelo link de status.
 *
 * Mesmo molde de confirmation-email.ts, inclusive o dedupe por
 * `updateMany({ where: { id, pixCodeEmailSentAt: null }, ... })`: uma
 * leitura seguida de write teria a mesma corrida que o compare-and-set
 * existe para fechar.
 */

import { prisma } from '@ccc/db';
import { presaleOrderStatusUrl } from '@ccc/shared/presale';
import type { FastifyBaseLogger } from 'fastify';

import { signQrCode } from '../../lib/qr.js';
import type { Mailer } from '../mailer/index.js';

export type SendPresalePixCodeEmailDeps = {
  mailer: Mailer;
  env: { TICKET_CODE_SECRET: string; GARAGE_WEB_BASE_URL: string };
  log: FastifyBaseLogger;
};

/**
 * Envia o email com o código Pix copia-e-cola de um pedido de pré-venda.
 * Devolve true se enviou, false se já tinha sido enviado (dedupe ativo) ou
 * se o pedido não é elegível (fora de escopo, sem brCode, não encontrado).
 *
 * Compare-and-set: `updateMany({ where: { id, origin: 'casa_in_box',
 * pixCodeEmailSentAt: null }, ... })` só envia se count === 1. Escopado por
 * origin ANTES de tocar o pedido — uma query de loja comum não pode ganhar
 * um carimbo de pré-venda.
 */
export const sendPresalePixCodeEmail = async (
  orderId: string,
  deps: SendPresalePixCodeEmailDeps,
): Promise<boolean> => {
  // Dedupe com updateMany contado, escopado por origin antes de tocar o
  // pedido: só uma entrega marca pixCodeEmailSentAt, o resto fica com
  // count === 0. Uma query sem o filtro de origin carimbaria pedido de loja
  // comum e pagaria uma consulta extra só pra descobrir que não devia.
  const marked = await prisma.order.updateMany({
    where: { id: orderId, origin: 'casa_in_box', pixCodeEmailSentAt: null },
    data: { pixCodeEmailSentAt: new Date() },
  });

  if (marked.count !== 1) {
    // Já tinha sido marcado, pedido não existe, ou não é de pré-venda
    return false;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { presaleGuest: true },
  });

  if (!order) {
    deps.log.error({ orderId }, 'sendPresalePixCodeEmail: pedido nao encontrado');
    return false;
  }

  if (!order.presaleGuest) {
    // Não deveria acontecer dado o filtro de origin acima, mas sem guest
    // não há para quem enviar.
    return false;
  }

  if (!order.brCode) {
    deps.log.error({ orderId }, 'sendPresalePixCodeEmail: pedido sem brCode');
    return false;
  }

  const token = signQrCode('p', orderId, deps.env);
  // Mesma função que monta o success_url da Stripe e o link do email de
  // confirmação. A rota e os nomes dos parâmetros moram em
  // @ccc/shared/presale, não aqui.
  const statusLink = presaleOrderStatusUrl(deps.env.GARAGE_WEB_BASE_URL, orderId, token);

  const total = (order.amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const html = `
    <p>Olá ${escapeHtml(order.presaleGuest.name)},</p>
    <p>Aqui está o código Pix para pagar o seu pedido #${escapeHtml(orderId)}.</p>

    <p style="margin-top: 20px;">
      <strong>Valor:</strong> ${total}
    </p>

    <p style="margin-top: 20px;">
      <strong>Código Pix copia e cola:</strong>
    </p>
    <p style="padding: 12px; background: #f5f5f5; border-radius: 4px; word-break: break-all; font-family: monospace;">
      ${escapeHtml(order.brCode)}
    </p>

    <p style="margin-top: 20px;">
      Copie o código acima e cole no app do seu banco para pagar. O código
      expira em até 1 hora.
    </p>

    <p style="margin-top: 20px;">
      <a href="${escapeHtml(statusLink)}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
        Ver status do pedido
      </a>
    </p>

    <p style="margin-top: 40px; color: #666; font-size: 12px;">
      Se tiver dúvidas sobre seu pedido, acesse o link acima para acompanhar o status.
    </p>
  `;

  try {
    await deps.mailer.send({
      to: order.presaleGuest.email,
      subject: 'Casa In Box — Pague com Pix',
      html,
    });
  } catch (err) {
    // SOLTA a reivindicação. O `updateMany` acima carimbou `pixCodeEmailSentAt`
    // ANTES do envio, que é o que fecha a corrida de envio duplo. Mas carimbar e
    // não soltar transforma uma falha transitória do mailer em perda definitiva:
    // nenhuma chamada futura passa no `where: { pixCodeEmailSentAt: null }`, e
    // este é justamente o email por causa do qual a janela do Pix é de 1 hora e
    // não de 15 minutos.
    //
    // Mesmo formato da reivindicação da cobrança em `checkout.ts`: reivindica,
    // age, e solta se a ação falhar.
    //
    // O email do convidado NÃO vai para o log: é dado pessoal, e o `orderId` já
    // basta para investigar.
    await prisma.order.updateMany({
      where: { id: orderId, origin: 'casa_in_box' },
      data: { pixCodeEmailSentAt: null },
    });

    deps.log.warn({ err, orderId }, 'sendPresalePixCodeEmail: falha ao enviar email');

    // Devolver `true` aqui mentiria para quem chama e para quem lê o log: nada
    // foi enviado. O checkout não quebra por causa disso — quem chama já trata
    // a falha de envio como degradação, não como erro.
    return false;
  }

  return true;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
