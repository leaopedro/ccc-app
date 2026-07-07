import { scrubSentryEvent } from '@jdm/shared/sentry-scrubber';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

type Extra = { sentryDsn?: string };

const dsn = (): string | undefined => (Constants.expoConfig?.extra as Extra | undefined)?.sentryDsn;

const MAX_CRUMB_LEN = 200;
const PII_RE = /[^@\s]+@[^@\s]+\.[^@\s]+|\d{3}\.\d{3}\.\d{3}-\d{2}/;

export const initSentry = () => {
  const sentryDsn = dsn();
  if (!sentryDsn) return;
  Sentry.init({
    dsn: sentryDsn,
    debug: false,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      const scrubbed = scrubSentryEvent(event);
      if (!scrubbed) return null;
      if (scrubbed.breadcrumbs) {
        scrubbed.breadcrumbs = scrubbed.breadcrumbs.filter((crumb) => {
          if (crumb.category !== 'console') return true;
          const msg = typeof crumb.message === 'string' ? crumb.message : '';
          if (msg.length > MAX_CRUMB_LEN || PII_RE.test(msg)) return false;
          const rawArgs: unknown = crumb.data?.['arguments'];
          if (Array.isArray(rawArgs) && rawArgs.length > 0) {
            const serialized = rawArgs
              .map((a: unknown) => {
                if (typeof a === 'string') return a;
                try {
                  return JSON.stringify(a);
                } catch {
                  return '[unserializable]';
                }
              })
              .join(' ');
            if (serialized.length > MAX_CRUMB_LEN || PII_RE.test(serialized)) return false;
          }
          return true;
        });
      }
      return scrubbed;
    },
    initialScope: {
      tags: { service: 'mobile' },
    },
  });
};

export const captureException = (error: unknown, context: string): void => {
  if (!dsn()) {
    console.error(`[sentry-disabled] ${context}`, error);
    return;
  }
  Sentry.captureException(error, {
    tags: { service: 'mobile', context },
  });
};
