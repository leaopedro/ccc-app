import { presignRequestSchema } from '@jdm/shared/uploads';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/uploads/presign', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub, role } = requireUser(request);
    const { kind, contentType, size } = presignRequestSchema.parse(request.body);
    if (kind === 'event_cover' && role !== 'organizer' && role !== 'admin') {
      return reply
        .status(403)
        .send({ error: 'Forbidden', message: 'role cannot upload event covers' });
    }
    if (kind === 'product_photo' && role !== 'organizer' && role !== 'admin') {
      return reply
        .status(403)
        .send({ error: 'Forbidden', message: 'role cannot upload product photos' });
    }
    const result = await app.uploads.presignPut({ kind, userId: sub, contentType, size });
    return {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      publicUrl: result.publicUrl,
      expiresAt: result.expiresAt.toISOString(),
      headers: result.headers,
    };
  });
};
