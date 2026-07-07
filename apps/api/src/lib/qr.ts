import { createHmac, timingSafeEqual } from 'node:crypto';

export type QrKind = 't' | 'e' | 'v';

const VALID_KINDS = new Set<string>(['t', 'e', 'v']);

type QrEnv = { readonly TICKET_CODE_SECRET: string };

// Kind byte is mixed into the HMAC input so cross-kind codes are rejected.
const sign = (kind: QrKind, id: string, secret: string): string =>
  createHmac('sha256', secret).update(kind).update('\x00').update(id).digest('base64url');

export const signQrCode = (kind: QrKind, id: string, env: QrEnv): string => {
  if (!id) throw new Error('id required');
  if (id.includes('.')) throw new Error('id must not contain "."');
  return `${kind}.${id}.${sign(kind, id, env.TICKET_CODE_SECRET)}`;
};

export const verifyQrCode = (code: string, env: QrEnv): { kind: QrKind; id: string } => {
  const parts = code.split('.');
  if (parts.length < 3) throw new Error('malformed qr code');

  const kindRaw = parts[0]!;
  const sig = parts[parts.length - 1]!;
  // id may itself contain no dots (enforced at sign time), but defensive slice
  const id = parts.slice(1, -1).join('.');

  if (!VALID_KINDS.has(kindRaw)) throw new Error(`unknown qr kind: ${kindRaw}`);
  if (!id) throw new Error('malformed qr code: empty id');

  const kind = kindRaw as QrKind;
  const expected = sign(kind, id, env.TICKET_CODE_SECRET);
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('invalid qr code signature');
  }

  return { kind, id };
};
