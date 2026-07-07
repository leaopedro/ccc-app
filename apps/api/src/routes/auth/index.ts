import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { forgotPasswordRoute } from './forgot-password.js';
import { loginRoute } from './login.js';
import { logoutRoute } from './logout.js';
import { mfaRecoveryRoute } from './mfa-recovery.js';
import { mfaVerifyRoute } from './mfa-verify.js';
import { refreshRoute } from './refresh.js';
import { resendVerifyRoute } from './resend-verify.js';
import { resetPasswordRoute } from './reset-password.js';
import { signupRoute } from './signup.js';
import { verifyRoute } from './verify.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
      keyGenerator: (req) => {
        const body = req.body as { email?: string } | undefined;
        const email = body?.email ?? '';
        return `${req.ip}:${email}`;
      },
    });

    await scoped.register(signupRoute);
    await scoped.register(verifyRoute);
    await scoped.register(resendVerifyRoute);
    await scoped.register(loginRoute);
    await scoped.register(refreshRoute);
    await scoped.register(logoutRoute);
    await scoped.register(forgotPasswordRoute);
    await scoped.register(resetPasswordRoute);
    await scoped.register(mfaVerifyRoute);
    await scoped.register(mfaRecoveryRoute);
  });
};
