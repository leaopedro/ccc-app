import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyRecoveryCode,
  verifyTotp,
} from '../../src/services/auth/mfa.js';

const TEST_KEY = 'a]3Fk9Lm#Q!rT7Wz$Xv2Yp6UjBnCdEh';

describe('MFA service', () => {
  describe('TOTP secret encryption', () => {
    it('round-trips encrypt/decrypt', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(secret, TEST_KEY);
      expect(encrypted).not.toBe(secret);
      expect(encrypted.split(':').length).toBe(3);
      const decrypted = decryptSecret(encrypted, TEST_KEY);
      expect(decrypted).toBe(secret);
    });

    it('produces different ciphertexts for same input', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const a = encryptSecret(secret, TEST_KEY);
      const b = encryptSecret(secret, TEST_KEY);
      expect(a).not.toBe(b);
    });
  });

  describe('TOTP generation and verification', () => {
    it('generates a valid otpauth URI', () => {
      const result = generateTotpSecret('user@test.com');
      expect(result.uri).toContain('otpauth://totp/');
      expect(result.uri).toContain('JDM%20Experience');
      expect(result.secret.length).toBeGreaterThan(10);
    });

    it('verifies a valid TOTP code', () => {
      const result = generateTotpSecret('user@test.com');
      const code = result.totp.generate();
      expect(verifyTotp(result.secret, code)).toBe(true);
    });

    it('rejects invalid TOTP code', () => {
      const result = generateTotpSecret('user@test.com');
      expect(verifyTotp(result.secret, '000000')).toBe(false);
    });
  });

  describe('recovery codes', () => {
    it('generates 10 unique codes in XXXX-XXXX format', () => {
      const codes = generateRecoveryCodes();
      expect(codes).toHaveLength(10);
      const unique = new Set(codes);
      expect(unique.size).toBe(10);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      }
    });

    it('hashes and verifies a recovery code with pepper', () => {
      const pepper = 'test-pepper-key';
      const code = 'ABCD-EF23-GHKM';
      const hash = hashRecoveryCode(code, pepper);
      expect(hash).not.toBe(code);
      expect(verifyRecoveryCode(code, hash, pepper)).toBe(true);
      expect(verifyRecoveryCode('WXYZ-1234-NPQR', hash, pepper)).toBe(false);
    });

    it('different pepper produces different hash', () => {
      const code = 'ABCD-EF23-GHKM';
      const hash1 = hashRecoveryCode(code, 'pepper-1');
      const hash2 = hashRecoveryCode(code, 'pepper-2');
      expect(hash1).not.toBe(hash2);
    });

    it('verification is case-insensitive', () => {
      const pepper = 'test-pepper-key';
      const code = 'ABCD-EF23-GHKM';
      const hash = hashRecoveryCode(code, pepper);
      expect(verifyRecoveryCode('abcd-ef23-ghkm', hash, pepper)).toBe(true);
    });
  });
});
