import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import {
  createExportJob,
  getExportJob,
  listExportJobs,
  buildSignedDownloadUrl,
  getR2ConfigFromEnv,
} from '../services/data-export.js';

export const meDataExportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/data-export', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const jobs = await listExportJobs(sub);
    return {
      items: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        expiresAt: j.expiresAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>(
    '/me/data-export/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { id } = request.params;
      const job = await getExportJob(id, sub);
      if (!job) return reply.status(404).send({ error: 'NotFound' });

      const isExpired =
        job.status === 'completed' && job.expiresAt && job.expiresAt.getTime() <= Date.now();
      if (isExpired) {
        return reply.status(410).send({ error: 'ExportExpired', id: job.id });
      }

      let downloadUrl: string | null = null;
      if (job.status === 'completed' && job.objectKey) {
        const r2Config = getR2ConfigFromEnv(app.env);
        if (r2Config) {
          const remainingSec = job.expiresAt
            ? Math.floor((job.expiresAt.getTime() - Date.now()) / 1000)
            : undefined;
          downloadUrl = await buildSignedDownloadUrl(r2Config, job.objectKey, remainingSec);
        }
      }

      if (job.status === 'failed' && job.errorMessage) {
        request.log.error({ jobId: job.id, detail: job.errorMessage }, 'data-export job failed');
      }

      return {
        id: job.id,
        status: job.status,
        downloadUrl,
        expiresAt: job.expiresAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
        ...(job.status === 'failed' && { error: 'ExportFailed' }),
      };
    },
  );

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 3,
      timeWindow: '1 hour',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `data-export:${auth.sub}` : `data-export-ip:${req.ip}`;
      },
    });

    scoped.post(
      '/me/data-export',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const { id, status } = await createExportJob(sub);

        if (status === 'processing') {
          return reply.status(200).send({ id, status, message: 'Export already in progress' });
        }

        return reply.status(202).send({ id, status });
      },
    );
  });
};
