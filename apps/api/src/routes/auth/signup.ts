import { prisma } from '@jdm/db';
import { authResponseSchema, signupSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { verificationMail } from '../../services/auth/mail-templates.js';
import { hashPassword } from '../../services/auth/password.js';
import { createAccessToken, issueRefreshToken } from '../../services/auth/tokens.js';
import { issueVerificationToken } from '../../services/auth/verification.js';
import { awardBadge } from '../../services/garage/awarder.js';
import { checkEligibility as checkSignupEligibility } from '../../services/garage/eligibility/signup.js';
import { defaultGarageSlugForUserId, findFreeGarageSlug } from '../../services/garage/index.js';

// Signup intentionally returns an access+refresh pair so mobile can navigate
// straight to the verify-email-pending screen without a separate login round
// trip. The access token is usable for ~15m while emailVerifiedAt is null —
// `/auth/login` gates on verification, and any verified-email-required
// endpoints MUST re-check `user.emailVerifiedAt` rather than trust the JWT.
//
// User row + Garage row are created in one tx. Garage defaults are neutral
// (name='Garagem', slug='user-<id8>', isPublic=false). NEVER derived from
// User.name — see docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md §2.1, §5.3.
// eslint-disable-next-line @typescript-eslint/require-await
export const signupRoute: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return reply.status(409).send({ error: 'Conflict', message: 'email already registered' });
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
        },
      });
      const baseSlug = defaultGarageSlugForUserId(created.id);
      const slug = await findFreeGarageSlug(tx, baseSlug);
      const garage = await tx.garage.create({
        data: {
          userId: created.id,
          name: 'Garagem',
          slug,
          isPublic: false,
        },
      });

      // Conquistas — JDM-003 (Fundador) is awarded inside the same tx as
      // the user+garage create so the founder cohort is atomically defined.
      // The awarder applies the premium-exclusive gate; founders signing
      // up free will see `premium_required` and no row will land. If they
      // upgrade later, a recompute path (deferred) can fill it in.
      const codes = checkSignupEligibility(tx, created.id, created.createdAt);
      for (const code of codes) {
        try {
          await awardBadge(tx, garage.id, code, `signup:${created.id}`);
        } catch (err) {
          app.log.warn({ err, garageId: garage.id, code }, 'awardBadge failed during signup');
        }
      }
      return created;
    });

    const verifyToken = await issueVerificationToken(user.id);
    const link = `${app.env.APP_WEB_BASE_URL}/verify?token=${encodeURIComponent(verifyToken)}`;
    await app.mailer.send(verificationMail(user.email, link));

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);
    const refresh = issueRefreshToken(app.env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });

    return reply.status(201).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: refresh.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
