import type { Breadcrumb } from '@sentry/node';

const MAX_CRUMB_LEN = 200;
// matches email addresses or formatted CPF (e.g. 123.456.789-01)
const PII_RE = /[^@\s]+@[^@\s]+\.[^@\s]+|\d{3}\.\d{3}\.\d{3}-\d{2}/;

export function dropRiskyConsoleBreadcrumbs(crumbs: Breadcrumb[]): Breadcrumb[] {
  return crumbs.filter((crumb) => {
    if (crumb.category !== 'console') return true;
    const msg = typeof crumb.message === 'string' ? crumb.message : '';
    if (msg.length > MAX_CRUMB_LEN || PII_RE.test(msg)) return false;
    const rawArgs: unknown = crumb.data?.['arguments'];
    if (Array.isArray(rawArgs) && rawArgs.length > 0) {
      const serialized = rawArgs
        .map((a) => {
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
