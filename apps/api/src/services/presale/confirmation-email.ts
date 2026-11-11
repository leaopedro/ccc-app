/**
 * Envio de email de confirmacao de pedido de pre-venda Casa In Box.
 *
 * O dedupe com compare-and-set é necessário, não defensivo: dois eventos
 * distintos do mesmo pagamento (payment_intent.succeeded e
 * checkout.session.completed) liquidam o mesmo pedido sob event.id
 * diferentes, e markProcessed roda depois do dispatch de propósito.
 */

import { prisma } from '@ccc/db';
import { presaleOrderStatusUrl } from '@ccc/shared/presale';
import type { FastifyBaseLogger } from 'fastify';

import { signQrCode } from '../../lib/qr.js';
import type { Mailer } from '../mailer/index.js';

export type SendPresaleConfirmationEmailDeps = {
  mailer: Mailer;
  env: { TICKET_CODE_SECRET: string; GARAGE_WEB_BASE_URL: string };
  log: FastifyBaseLogger;
};

/**
 * Envia email de confirmacao de pedido de pre-venda.
 * Devolve true se enviou, false se ja tinha sido enviado (dedupe ativo).
 *
 * Compare-and-set: `updateMany({ where: { id, confirmationEmailSentAt: null }, ... })`
 * só envia se count === 1. Uma leitura seguida de write teria a mesma corrida.
 */
export const sendPresaleConfirmationEmail = async (
  orderId: string,
  deps: SendPresaleConfirmationEmailDeps,
): Promise<boolean> => {
  // Dedupe com updateMany contado: só uma entrega marca
  // confirmationEmailSentAt, o resto fica com count === 0
  const marked = await prisma.order.updateMany({
    where: { id: orderId, confirmationEmailSentAt: null },
    data: { confirmationEmailSentAt: new Date() },
  });

  if (marked.count !== 1) {
    // Ja tinha sido marcado, ou pedido nao existe
    return false;
  }

  // Carrega o pedido, o guest e os itens
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      presaleGuest: true,
      items: {
        include: {
          variant: {
            include: { product: true },
          },
        },
      },
    },
  });

  if (!order) {
    deps.log.error({ orderId }, 'sendPresaleConfirmationEmail: order nao encontrado');
    return false;
  }

  if (!order.presaleGuest) {
    // Not a presale order, or presaleGuest was deleted
    return false;
  }

  // Monta o token para a rota de status
  const token = signQrCode('p', orderId, deps.env);
  // Mesma função que monta o success_url da Stripe. A rota e os nomes dos
  // parâmetros moram em @ccc/shared/presale, não aqui.
  const statusLink = presaleOrderStatusUrl(deps.env.GARAGE_WEB_BASE_URL, orderId, token);

  // Composicao do email: itens, totais, forma de entrega
  const itemsHtml = order.items
    .map((item) => {
      const productName = item.variant?.product?.title ?? 'Produto desconhecido';
      const quantity = item.quantity;
      const unitPrice = (item.unitPriceCents / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      const subtotal = (item.subtotalCents / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

      return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">
            <strong>${escapeHtml(productName)}</strong><br>
            Quantidade: ${quantity}
          </td>
          <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">
            ${unitPrice} x ${quantity} = ${subtotal}
          </td>
        </tr>
      `;
    })
    .join('');

  const subtotal = (order.baseAmountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const shipping = (order.shippingCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const total = (order.amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const fulfillmentLabel =
    order.fulfillmentMethod === 'pickup' ? 'Retirada no local agendado' : 'Entrega por mensageiro';

  const html = `
    <p>Olá ${escapeHtml(order.presaleGuest.name)},</p>
    <p>Obrigado pela sua compra! Seu pedido foi confirmado.</p>

    <h3>Detalhes do pedido #${escapeHtml(orderId)}</h3>
    <table style="width: 100%; border-collapse: collapse;">
      ${itemsHtml}
      <tr>
        <td style="padding: 8px; text-align: right;"><strong>Subtotal:</strong></td>
        <td style="padding: 8px; text-align: right;"><strong>${subtotal}</strong></td>
      </tr>
      <tr>
        <td style="padding: 8px; text-align: right;"><strong>Entrega:</strong></td>
        <td style="padding: 8px; text-align: right;"><strong>${shipping}</strong></td>
      </tr>
      <tr style="background: #f5f5f5;">
        <td style="padding: 8px; text-align: right;"><strong>Total:</strong></td>
        <td style="padding: 8px; text-align: right;"><strong>${total}</strong></td>
      </tr>
    </table>

    <p style="margin-top: 20px;">
      <strong>Forma de recebimento:</strong> ${fulfillmentLabel}
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
      subject: 'Casa In Box — Pedido confirmado',
      html,
    });
  } catch (err) {
    deps.log.warn(
      { err, orderId, guestEmail: order.presaleGuest.email },
      'sendPresaleConfirmationEmail: falha ao enviar email',
    );
    // Nao reverte: dinheiro entrou, não tem sentido derrubar o webhook
    // porque o mailer caiu. Apenas loga e segue.
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
