import { describe, expect, it } from 'vitest';

import { signQrCode, verifyQrCode } from '../../src/lib/qr.js';

const env = { TICKET_CODE_SECRET: 'a'.repeat(32) };

describe('qr signer – kind discriminator', () => {
  describe('ticket kind (t)', () => {
    it('round-trip: sign then verify returns original id and kind', () => {
      const code = signQrCode('t', 'ticket_abc123', env);
      const result = verifyQrCode(code, env);
      expect(result.kind).toBe('t');
      expect(result.id).toBe('ticket_abc123');
    });

    it('code starts with kind prefix', () => {
      const code = signQrCode('t', 'ticket_abc123', env);
      expect(code.startsWith('t.')).toBe(true);
    });
  });

  describe('extra kind (e)', () => {
    it('round-trip: sign then verify returns original id and kind', () => {
      const code = signQrCode('e', 'extra_xyz789', env);
      const result = verifyQrCode(code, env);
      expect(result.kind).toBe('e');
      expect(result.id).toBe('extra_xyz789');
    });

    it('code starts with kind prefix', () => {
      const code = signQrCode('e', 'extra_xyz789', env);
      expect(code.startsWith('e.')).toBe(true);
    });
  });

  describe('cross-kind forgery rejection', () => {
    it('ticket code rejected when parsed as extra', () => {
      const ticketCode = signQrCode('t', 'ticket_abc123', env);
      // Swap the kind prefix to 'e' — signature must be invalid
      const forged = 'e' + ticketCode.slice(1);
      expect(() => verifyQrCode(forged, env)).toThrow();
    });

    it('extra code rejected when parsed as ticket', () => {
      const extraCode = signQrCode('e', 'extra_xyz789', env);
      const forged = 't' + extraCode.slice(1);
      expect(() => verifyQrCode(forged, env)).toThrow();
    });
  });

  describe('tamper detection', () => {
    it('rejects tampered id', () => {
      const code = signQrCode('t', 'ticket_abc123', env);
      const parts = code.split('.');
      // parts: [kind, id, sig]
      const tampered = [parts[0], 'ticket_evil', parts[2]].join('.');
      expect(() => verifyQrCode(tampered, env)).toThrow();
    });

    it('rejects tampered signature', () => {
      const code = signQrCode('t', 'ticket_abc123', env);
      const parts = code.split('.');
      const tampered = [parts[0], parts[1], 'deadbeef'].join('.');
      expect(() => verifyQrCode(tampered, env)).toThrow();
    });

    it('rejects malformed code (no dots)', () => {
      expect(() => verifyQrCode('nodots', env)).toThrow();
    });

    it('rejects malformed code (missing sig segment)', () => {
      expect(() => verifyQrCode('t.someid', env)).toThrow();
    });

    it('rejects unknown kind byte', () => {
      // manually craft a code with kind 'x' — not a valid kind
      expect(() => verifyQrCode('x.someid.fakesig', env)).toThrow();
    });
  });

  describe('secrets isolation', () => {
    it('signatures differ across secrets', () => {
      const a = signQrCode('t', 'ticket_1', { TICKET_CODE_SECRET: 'a'.repeat(32) });
      const b = signQrCode('t', 'ticket_1', { TICKET_CODE_SECRET: 'b'.repeat(32) });
      expect(a).not.toBe(b);
    });

    it('code signed with secret A rejected by secret B', () => {
      const code = signQrCode('t', 'ticket_1', { TICKET_CODE_SECRET: 'a'.repeat(32) });
      expect(() => verifyQrCode(code, { TICKET_CODE_SECRET: 'b'.repeat(32) })).toThrow();
    });
  });

  describe('id validation', () => {
    it('refuses to sign id containing "."', () => {
      expect(() => signQrCode('t', 'bad.id', env)).toThrow();
    });

    it('refuses to sign empty id', () => {
      expect(() => signQrCode('t', '', env)).toThrow();
    });
  });
});
