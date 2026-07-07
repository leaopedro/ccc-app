import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export type {
  Prisma,
  User,
  AuthProvider,
  AuthProviderKind,
  RefreshToken,
  VerificationToken,
  PasswordResetToken,
  UserRole,
} from '@prisma/client';

export * from './garage-spot-product.js';
