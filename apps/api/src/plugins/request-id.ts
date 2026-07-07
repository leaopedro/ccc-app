import { randomUUID } from 'node:crypto';

import fp from 'fastify-plugin';

// eslint-disable-next-line @typescript-eslint/require-await
export const requestIdPlugin = fp(async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    request.id = id;
    void reply.header('x-request-id', id);
  });
});
