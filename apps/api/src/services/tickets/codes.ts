import { createHmac, timingSafeEqual } from 'node:crypto';

type CodeEnv = { readonly TICKET_CODE_SECRET: string };

const sign = (ticketId: string, secret: string): string =>
  createHmac('sha256', secret).update(ticketId).digest('base64url');

export const signTicketCode = (ticketId: string, env: CodeEnv): string => {
  if (!ticketId) throw new Error('ticketId required');
  if (ticketId.includes('.')) throw new Error('ticketId must not contain "."');
  return `${ticketId}.${sign(ticketId, env.TICKET_CODE_SECRET)}`;
};

export const verifyTicketCode = (code: string, env: CodeEnv): string => {
  const dot = code.indexOf('.');
  if (dot <= 0 || dot === code.length - 1) throw new Error('malformed ticket code');
  const ticketId = code.slice(0, dot);
  const provided = code.slice(dot + 1);
  const expected = sign(ticketId, env.TICKET_CODE_SECRET);
  const a = Buffer.from(provided, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('invalid ticket code signature');
  }
  return ticketId;
};
