import type { PushSender } from '../push/index.js';
import { sendTransactionalPush } from '../push/transactional.js';

export type BoxPushKind = 'box.paid' | 'box.ready' | 'box.shipped' | 'box.delivered';

const COPY: Record<BoxPushKind, { title: string; body: string }> = {
  'box.paid': {
    title: 'Pagamento confirmado',
    body: 'Recebemos o pagamento. Sua caixa está confirmada.',
  },
  'box.ready': {
    title: 'Caixa confirmada',
    body: 'Sua caixa deste mês foi fechada e entrou na fila.',
  },
  'box.shipped': {
    title: 'Caixa enviada',
    body: 'Sua caixa saiu para entrega.',
  },
  'box.delivered': {
    title: 'Caixa entregue',
    body: 'Sua caixa foi entregue. Aproveite.',
  },
};

// Single reuse point for all four box milestone pushes. dedupeKey = boxId
// (kind is already part of Notification's unique key). Destination lands the
// member on the Caixa screen after they open the inbox item.
export const sendBoxPush = async (
  sender: PushSender,
  input: { userId: string; boxId: string; kind: BoxPushKind },
): Promise<void> => {
  const copy = COPY[input.kind];
  await sendTransactionalPush(
    {
      userId: input.userId,
      kind: input.kind,
      dedupeKey: input.boxId,
      title: copy.title,
      body: copy.body,
      data: { boxId: input.boxId },
      destination: { kind: 'internal_path', path: '/caixa' },
    },
    { sender },
  );
};
