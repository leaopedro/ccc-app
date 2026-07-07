import { scrubSentryEvent } from '@jdm/shared/sentry-scrubber';
import * as Sentry from '@sentry/node';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';
import { dropRiskyConsoleBreadcrumbs } from '../lib/sentry-breadcrumb-filter.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const sentryPlugin = fp<{ env: Env }>(async (app, opts) => {
  if (!opts.env.SENTRY_DSN) {
    app.log.info('Sentry disabled (no SENTRY_DSN)');
    return;
  }

  Sentry.init({
    dsn: opts.env.SENTRY_DSN,
    environment: opts.env.NODE_ENV,
    release: opts.env.GIT_SHA,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      const scrubbed = scrubSentryEvent(event);
      if (!scrubbed) return null;
      if (scrubbed.breadcrumbs) {
        scrubbed.breadcrumbs = dropRiskyConsoleBreadcrumbs(scrubbed.breadcrumbs);
      }
      return scrubbed;
    },
    initialScope: {
      tags: { service: 'api' },
    },
  });

  app.addHook('onError', async (request, _reply, error) => {
    Sentry.withScope((scope) => {
      scope.setTag('request_id', request.id);
      Sentry.captureException(error);
    });
  });
});
