import type { Env } from '../../env.js';

import { DevMailer } from './dev.js';
import { ResendMailer } from './resend.js';
import type { Mailer } from './types.js';

export type { Mailer, MailMessage } from './types.js';
export { DevMailer } from './dev.js';

export const buildMailer = (env: Env): Mailer => {
  if (env.NODE_ENV === 'production') {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY required in production');
    }
    return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  return new DevMailer();
};
