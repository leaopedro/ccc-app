import * as Sentry from '@sentry/nextjs';

import { buildAdminSentryOptions } from '~/lib/sentry-config';

Sentry.init(buildAdminSentryOptions(process.env.SENTRY_DSN, 'server'));
