import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { TOTP, Secret } from 'otpauth';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ISSUER = 'Casa Car Club';
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;

const toKeyBuf = (key: string): Buffer => {
  const raw = Buffer.from(key, 'utf8');
  const buf = Buffer.alloc(32);
  raw.copy(buf, 0, 0, Math.min(raw.length, 32));
  return buf;
};

export const encryptSecret = (plaintext: string, key: string): string => {
  const keyBuf = toKeyBuf(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

export const decryptSecret = (ciphertext: string, key: string): string => {
  const keyBuf = toKeyBuf(key);
  const parts = ciphertext.split(':');
  const iv = Buffer.from(parts[0]!, 'base64');
  const authTag = Buffer.from(parts[1]!, 'base64');
  const data = Buffer.from(parts[2]!, 'base64');
  const decipher = createDecipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
};

export const generateTotpSecret = (
  accountName: string,
): { secret: string; uri: string; totp: TOTP } => {
  const secret = new Secret();
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountName,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString(), totp };
};

export const verifyTotp = (base32Secret: string, code: string): boolean => {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(base32Secret),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
};

const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const generateRecoveryCodes = (count = 10): string[] => {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(12);
    let code = '';
    for (let j = 0; j < 12; j++) {
      code += SAFE_CHARS[bytes[j]! % SAFE_CHARS.length];
      if (j === 3 || j === 7) code += '-';
    }
    codes.push(code);
  }
  return codes;
};

export const hashRecoveryCode = (code: string, pepper: string): string => {
  return createHmac('sha256', pepper).update(code.toUpperCase()).digest('hex');
};

export const verifyRecoveryCode = (code: string, hash: string, pepper: string): boolean => {
  return hashRecoveryCode(code, pepper) === hash;
};
