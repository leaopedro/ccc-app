import pino, { type LoggerOptions } from 'pino';

import type { Env } from './env.js';

const SENSITIVE_PARAMS = ['webhookSecret'];

export function stripSensitiveQueryParams(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  for (const param of SENSITIVE_PARAMS) {
    parsed.searchParams.delete(param);
  }
  return `${parsed.pathname}${parsed.search}`;
}

export const buildLoggerOptions = (env: Env): LoggerOptions => {
  const opts: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { service: 'api', sha: env.GIT_SHA },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-webhook-signature"]',
        '*.password',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(raw: Parameters<typeof pino.stdSerializers.req>[0]) {
        const serialized = pino.stdSerializers.req(raw);
        if (serialized.url) {
          serialized.url = stripSensitiveQueryParams(serialized.url);
        }
        return serialized;
      },
    },
  };
  if (env.NODE_ENV === 'development') {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    };
  }
  return opts;
};

export const createLogger = (env: Env) => pino(buildLoggerOptions(env));
