import { createHmac, randomBytes } from 'node:crypto';

import type { UserRoleName } from '@jdm/shared/auth';
import jwt from 'jsonwebtoken';

type TokenEnv = {
  readonly JWT_ACCESS_SECRET: string;
  readonly REFRESH_TOKEN_PEPPER: string;
};

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3_600_000;

export type AccessPayload = {
  sub: string;
  role: UserRoleName;
};

export const createAccessToken = (payload: AccessPayload, env: TokenEnv): string => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
  });
};

export type VerifiedAccessPayload = AccessPayload & { iat: number };

export const verifyAccessToken = (token: string, env: TokenEnv): VerifiedAccessPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('unexpected jwt payload');
  const { sub, role, iat } = decoded as jwt.JwtPayload & AccessPayload;
  if (typeof sub !== 'string' || typeof role !== 'string') throw new Error('invalid jwt payload');
  if (typeof iat !== 'number') throw new Error('missing iat in jwt');
  return { sub, role, iat };
};

export const hashRefreshToken = (token: string, env: TokenEnv): string => {
  return createHmac('sha256', env.REFRESH_TOKEN_PEPPER).update(token).digest('hex');
};

export const issueRefreshToken = (
  env: TokenEnv,
): { token: string; hash: string; expiresAt: Date } => {
  const token = randomBytes(32).toString('base64url');
  const hash = hashRefreshToken(token, env);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  return { token, hash, expiresAt };
};

export const accessTtlSeconds = ACCESS_TTL_SECONDS;

const MFA_TTL_SECONDS = 5 * 60;

export type MfaPayload = {
  sub: string;
  purpose: 'mfa_challenge';
};

export const createMfaToken = (userId: string, env: TokenEnv): string => {
  return jwt.sign({ sub: userId, purpose: 'mfa_challenge' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: MFA_TTL_SECONDS,
  });
};

export const verifyMfaToken = (token: string, env: TokenEnv): MfaPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('unexpected jwt payload');
  const { sub, purpose } = decoded as jwt.JwtPayload & MfaPayload;
  if (typeof sub !== 'string' || purpose !== 'mfa_challenge') {
    throw new Error('invalid mfa token');
  }
  return { sub, purpose };
};
