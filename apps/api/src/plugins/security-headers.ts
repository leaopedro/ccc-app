import fp from 'fastify-plugin';

// eslint-disable-next-line @typescript-eslint/require-await
export const securityHeadersPlugin = fp(async (app) => {
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    void reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    void reply.header('X-XSS-Protection', '0');
    void reply.header('X-DNS-Prefetch-Control', 'off');
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    void reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  });
});
