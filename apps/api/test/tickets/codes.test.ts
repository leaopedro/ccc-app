import { describe, expect, it } from 'vitest';

import { signTicketCode, verifyTicketCode } from '../../src/services/tickets/codes.js';

const env = { TICKET_CODE_SECRET: 'a'.repeat(32) };

describe('ticket codes', () => {
  it('signs and verifies a round-trip', () => {
    const code = signTicketCode('ticket_123', env);
    expect(code.startsWith('ticket_123.')).toBe(true);
    expect(verifyTicketCode(code, env)).toBe('ticket_123');
  });

  it('rejects tampered ticket id', () => {
    const code = signTicketCode('ticket_123', env);
    const [, sig] = code.split('.');
    expect(() => verifyTicketCode(`ticket_999.${sig}`, env)).toThrow();
  });

  it('rejects tampered signature', () => {
    const code = signTicketCode('ticket_123', env);
    const [id] = code.split('.');
    expect(() => verifyTicketCode(`${id}.deadbeef`, env)).toThrow();
  });

  it('rejects malformed code', () => {
    expect(() => verifyTicketCode('no-dot-here', env)).toThrow();
    expect(() => verifyTicketCode('', env)).toThrow();
  });

  it('signatures differ across secrets', () => {
    const a = signTicketCode('t1', { TICKET_CODE_SECRET: 'a'.repeat(32) });
    const b = signTicketCode('t1', { TICKET_CODE_SECRET: 'b'.repeat(32) });
    expect(a).not.toBe(b);
  });

  it('rejects equal-length forged signature (covers timingSafeEqual byte compare)', () => {
    const code = signTicketCode('ticket_123', env);
    const [id, sig] = code.split('.');
    const flipped = Buffer.from(sig!, 'base64url');
    flipped[0] = flipped[0]! ^ 0x01;
    expect(() => verifyTicketCode(`${id!}.${flipped.toString('base64url')}`, env)).toThrow();
  });

  it('refuses to sign a ticketId containing "."', () => {
    expect(() => signTicketCode('a.b', env)).toThrow();
  });
});
