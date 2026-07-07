import { type FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

// eslint-disable-next-line @typescript-eslint/require-await
export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error, reqId: request.id }, 'request failed');

    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'ValidationError', issues: error.flatten() });
    }

    const statusCode = error.statusCode ?? 500;
    const expose = statusCode < 500;
    return reply.status(statusCode).send({
      error: expose ? error.name : 'InternalServerError',
      message: expose ? error.message : 'Something went wrong',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ error: 'NotFound', path: request.url });
  });
});
