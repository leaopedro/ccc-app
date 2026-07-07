import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const CURRENT_VERSION = 'enc_v1';

const HEX_RE = /^[0-9a-f]+$/i;
const IV_HEX_LEN = IV_BYTES * 2;
const TAG_HEX_LEN = AUTH_TAG_BYTES * 2;

const keyBuffer = (hexKey: string): Buffer => {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return buf;
};

export const isEncrypted = (value: string): boolean => {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== CURRENT_VERSION) return false;
  const iv = parts[1]!;
  const data = parts[2]!;
  const tag = parts[3]!;
  return (
    iv.length === IV_HEX_LEN &&
    HEX_RE.test(iv) &&
    data.length % 2 === 0 &&
    (data.length === 0 || HEX_RE.test(data)) &&
    tag.length === TAG_HEX_LEN &&
    HEX_RE.test(tag)
  );
};

export const encryptField = (plaintext: string, hexKey: string): string => {
  const key = keyBuffer(hexKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CURRENT_VERSION}:${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
};

export const decryptField = (ciphertext: string | null, hexKey: string): string | null => {
  if (ciphertext === null || ciphertext === undefined) return null;
  if (!isEncrypted(ciphertext)) return ciphertext;
  try {
    const parts = ciphertext.split(':');
    const ivHex = parts[1]!;
    const dataHex = parts[2]!;
    const tagHex = parts[3]!;
    const key = keyBuffer(hexKey);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'), {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
};
