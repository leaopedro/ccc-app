import { prisma } from '@jdm/db';
import {
  ACCOUNT_DISABLED_ERROR,
  INACTIVE_USER_STATUSES,
  type UserRoleName,
} from '@jdm/shared/auth';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';

import {
  verifyAccessToken,
  type AccessPayload,
  type VerifiedAccessPayload,
} from '../services/auth/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    tryAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: UserRoleName[]) => preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    user?: AccessPayload;
  }
}

/**
 * Narrowing helper for handlers that run after `app.authenticate`.
 * The preHandler guarantees `request.user` is set; this asserts it to TS.
 */
export const requireUser = (request: FastifyRequest): AccessPayload => {
  if (!request.user) {
    throw new Error('requireUser called without authenticate preHandler');
  }
  return request.user;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const authPlugin = fp(async (app) => {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'missing bearer token' });
    }
    const token = header.slice('Bearer '.length);
    let payload: VerifiedAccessPayload;
    try {
      payload = verifyAccessToken(token, app.env);
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid token' });
    }
    const userRow = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tokenInvalidatedAt: true },
    });
    if (!userRow || (INACTIVE_USER_STATUSES as readonly string[]).includes(userRow.status)) {
      return reply
        .status(401)
        .send({ error: ACCOUNT_DISABLED_ERROR, message: 'account is disabled' });
    }
    if (
      userRow.tokenInvalidatedAt &&
      payload.iat <= Math.floor(userRow.tokenInvalidatedAt.getTime() / 1000)
    ) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'session invalidated' });
    }
    request.user = payload;
    return undefined;
  });

  app.decorate('tryAuth', async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const token = header.slice('Bearer '.length);
    try {
      const payload = verifyAccessToken(token, app.env);
      const userRow = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });
      if (!userRow || (INACTIVE_USER_STATUSES as readonly string[]).includes(userRow.status))
        return;
      request.user = payload;
    } catch {
      // invalid token on optional-auth route — treat as anonymous
    }
  });

  app.decorate('requireRole', (...roles: UserRoleName[]): preHandlerAsyncHookHandler => {
    const allowed = new Set(roles);
    return async (request, reply) => {
      const user = requireUser(request);
      if (!allowed.has(user.role)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'insufficient role' });
      }
      return undefined;
    };
  });
});
