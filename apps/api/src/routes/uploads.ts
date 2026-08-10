import { presignRequestSchema } from '@ccc/shared/uploads';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/uploads/presign', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub, role } = requireUser(request);
    const { kind, contentType, size } = presignRequestSchema.parse(request.body);
    const organizerOnlyKinds = new Set([
      'event_cover',
      'product_photo',
      'box_item',
      'partner_logo',
      'partner_module',
    ]);
    if (organizerOnlyKinds.has(kind) && role !== 'organizer' && role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: `role cannot upload ${kind}` });
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
