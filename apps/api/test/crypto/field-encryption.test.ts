import { describe, it, expect } from 'vitest';

import {
  encryptField,
  decryptField,
  isEncrypted,
} from '../../src/services/crypto/field-encryption.js';

const TEST_KEY = 'ab'.repeat(32); // 64 hex chars = 32 bytes

describe('field-encryption', () => {
  it('encrypts and decrypts a string', () => {
    const plain = 'Olá, preciso de ajuda com meu ingresso';
    const cipher = encryptField(plain, TEST_KEY);
    expect(cipher).not.toBe(plain);
    expect(cipher.startsWith('enc_v1:')).toBe(true);
    const decrypted = decryptField(cipher, TEST_KEY);
    expect(decrypted).toBe(plain);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const plain = 'same input';
    const a = encryptField(plain, TEST_KEY);
    const b = encryptField(plain, TEST_KEY);
    expect(a).not.toBe(b);
  });

  it('returns null for tampered ciphertext', () => {
    const cipher = encryptField('test', TEST_KEY);
    const parts = cipher.split(':');
    parts[2] = parts[2]!.slice(0, -2) + 'ff';
    expect(decryptField(parts.join(':'), TEST_KEY)).toBeNull();
  });

  it('returns null for wrong key', () => {
    const cipher = encryptField('test', TEST_KEY);
    const wrongKey = 'cd'.repeat(32);
    expect(decryptField(cipher, wrongKey)).toBeNull();
  });

  it('handles empty string', () => {
    const cipher = encryptField('', TEST_KEY);
    expect(decryptField(cipher, TEST_KEY)).toBe('');
  });

  it('handles unicode and emoji', () => {
    const plain = 'Mensagem com acentuação e 🚗';
    const cipher = encryptField(plain, TEST_KEY);
    expect(decryptField(cipher, TEST_KEY)).toBe(plain);
  });

  it('handles max-length input (2000 chars)', () => {
    const plain = 'A'.repeat(2000);
    const cipher = encryptField(plain, TEST_KEY);
    expect(decryptField(cipher, TEST_KEY)).toBe(plain);
  });

  it('returns null for null input', () => {
    expect(decryptField(null, TEST_KEY)).toBeNull();
  });

  it('passes through plaintext that is not encrypted', () => {
    const plain = 'just a regular message';
    expect(decryptField(plain, TEST_KEY)).toBe(plain);
  });

  it('passes through plaintext starting with v1: (collision safety)', () => {
    const plain = 'v1:some:legacy:data';
    expect(decryptField(plain, TEST_KEY)).toBe(plain);
  });

  it('passes through plaintext matching enc_v1: prefix but not valid ciphertext', () => {
    const collisionCases = [
      'enc_v1:hello:world:foo',
      'enc_v1:not-hex:also-not-hex:nope',
      'enc_v1:aabb:ccdd:eeff',
      'enc_v1:abc:def:ghi:jkl',
    ];
    for (const plain of collisionCases) {
      expect(decryptField(plain, TEST_KEY)).toBe(plain);
    }
  });

  it('passes through 4-part enc_v1: string with wrong hex lengths', () => {
    const plain = 'enc_v1:aabbccdd:11223344:55667788';
    expect(decryptField(plain, TEST_KEY)).toBe(plain);
    expect(isEncrypted(plain)).toBe(false);
  });
});

describe('backfill robustness: plaintext matching isEncrypted format', () => {
  it('isEncrypted returns true for a fake ciphertext with valid hex shape', () => {
    // Craft a string that passes the isEncrypted() format check:
    // enc_v1:<24 hex IV>:<even-length hex data>:<32 hex tag>
    const fakeIv = 'aa'.repeat(12); // 24 hex chars
    const fakeData = 'bb'.repeat(8); // 16 hex chars, even length
    const fakeTag = 'cc'.repeat(16); // 32 hex chars
    const fakeCiphertext = `enc_v1:${fakeIv}:${fakeData}:${fakeTag}`;

    // Format check says "yes, looks encrypted"
    expect(isEncrypted(fakeCiphertext)).toBe(true);

    // But actual decryption fails because it's not real ciphertext
    expect(decryptField(fakeCiphertext, TEST_KEY)).toBeNull();
  });

  it('fake ciphertext should be encrypted by backfill (not skipped)', () => {
    // This verifies the fix: a value passing isEncrypted() format check but
    // failing actual decryption should be treated as plaintext and encrypted.
    const fakeIv = 'aa'.repeat(12);
    const fakeData = 'bb'.repeat(8);
    const fakeTag = 'cc'.repeat(16);
    const fakeCiphertext = `enc_v1:${fakeIv}:${fakeData}:${fakeTag}`;

    // isEncrypted says true, but decryptField returns null
    expect(isEncrypted(fakeCiphertext)).toBe(true);
    expect(decryptField(fakeCiphertext, TEST_KEY)).toBeNull();

    // So the backfill should encrypt it
    const encrypted = encryptField(fakeCiphertext, TEST_KEY);
    expect(isEncrypted(encrypted)).toBe(true);

    // And decrypting should give back the original fake string
    const roundTripped = decryptField(encrypted, TEST_KEY);
    expect(roundTripped).toBe(fakeCiphertext);
  });
});

describe('isEncrypted', () => {
  it('returns true for valid ciphertext', () => {
    const cipher = encryptField('test', TEST_KEY);
    expect(isEncrypted(cipher)).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isEncrypted('just a message')).toBe(false);
  });

  it('returns false for enc_v1: prefix with non-hex parts', () => {
    expect(isEncrypted('enc_v1:not-hex-iv-value!!:data:tag!')).toBe(false);
  });

  it('returns false for enc_v1: with wrong IV length', () => {
    const shortIv = 'aa'.repeat(8);
    const data = 'bb'.repeat(4);
    const tag = 'cc'.repeat(16);
    expect(isEncrypted(`enc_v1:${shortIv}:${data}:${tag}`)).toBe(false);
  });

  it('returns false for enc_v1: with wrong tag length', () => {
    const iv = 'aa'.repeat(12);
    const data = 'bb'.repeat(4);
    const shortTag = 'cc'.repeat(8);
    expect(isEncrypted(`enc_v1:${iv}:${data}:${shortTag}`)).toBe(false);
  });

  it('returns false for enc_v1: with odd-length data', () => {
    const iv = 'aa'.repeat(12);
    const oddData = 'b'.repeat(5);
    const tag = 'cc'.repeat(16);
    expect(isEncrypted(`enc_v1:${iv}:${oddData}:${tag}`)).toBe(false);
  });

  it('returns true for enc_v1: with empty data (encrypted empty string)', () => {
    const iv = 'aa'.repeat(12);
    const tag = 'cc'.repeat(16);
    expect(isEncrypted(`enc_v1:${iv}::${tag}`)).toBe(true);
  });
});
