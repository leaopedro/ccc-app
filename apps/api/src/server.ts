import { buildApp } from './app.js';
import { loadEnv } from './env.js';

const log = (msg: string) => process.stdout.write(`${msg}\n`);

const fatal = (label: string, err: unknown): never => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  log(`[server] ${label}: ${msg}`);
  process.exit(1);
};

process.on('uncaughtException', (err) => fatal('uncaughtException', err));
process.on('unhandledRejection', (err) => fatal('unhandledRejection', err));

const main = async () => {
  log('[server] loading env');
  const env = loadEnv();
  log(`[server] env loaded (NODE_ENV=${env.NODE_ENV}, PORT=${env.PORT})`);

  const app = await buildApp(env);
  log('[server] app built, binding port');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutdown initiated');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  log(`[server] listening on 0.0.0.0:${env.PORT}`);
};

main().catch((err) => fatal('startup failed', err));
