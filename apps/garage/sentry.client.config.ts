import * as Sentry from '@sentry/nextjs';

import { buildGarageSentryOptions } from '~/lib/sentry-config';

Sentry.init(buildGarageSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, 'client'));
