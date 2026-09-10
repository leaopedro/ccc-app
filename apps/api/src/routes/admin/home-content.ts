/**
 * home-content admin — escrita do conteudo institucional da tela de Inicio.
 *
 *   GET  /admin/home/content
 *   PUT  /admin/home/content
 *   POST /admin/home/images/presign
 *
 * Registrado no bloco requireRole('organizer','admin') de ./index.ts, o mesmo
 * de general-settings. Staff e rejeitado la.
 */

import { prisma } from '@ccc/db';
import { HOME_MEDIA_OBJECT_KEY_RE, homeContentUpdateSchema } from '@ccc/shared/admin-home';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';
import type { HomeContent as DbHomeContent, Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { ensureHomeContent } from '../../services/home-content.js';

const serializeAdminHomeContent = (app: FastifyInstance, row: DbHomeContent) => {
  const mediaUrl = (key: string | null): string | null =>
    key ? app.uploads.buildPublicUrl(key) : null;
  return {
    heroTitle: row.heroTitle,
    heroSubtitle: row.heroSubtitle,
    heroBannerObjectKey: row.heroBannerObjectKey,
    heroBannerUrl: mediaUrl(row.heroBannerObjectKey),
    institutionalTitle: row.institutionalTitle,
    institutionalBody: row.institutionalBody,
    institutionalImageObjectKey: row.institutionalImageObjectKey,
    institutionalImageUrl: mediaUrl(row.institutionalImageObjectKey),
    updatedAt: row.updatedAt.toISOString(),
  };
};

export const adminHomeContentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/home/content', async () => {
    const row = await ensureHomeContent();
    return serializeAdminHomeContent(app, row);
  });

  // Campos de conteudo, na ordem em que aparecem no form. O diff percorre esta
  // lista em vez de seis blocos repetidos.
  const CONTENT_FIELDS = [
    'heroTitle',
    'heroSubtitle',
    'heroBannerObjectKey',
    'institutionalTitle',
    'institutionalBody',
    'institutionalImageObjectKey',
  ] as const;

  const IMAGE_FIELDS = ['heroBannerObjectKey', 'institutionalImageObjectKey'] as const;

  app.put('/home/content', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = homeContentUpdateSchema.parse(request.body);

    // Prefixo antes de qualquer escrita. Sem isso um organizer aponta o banner
    // para feed_photo/<outro-usuario>/x.jpg e GET /api/home-content, que e
    // publico e sem auth, resolve e publica a foto. Mesma guarda de
    // box-catalog-admin.ts:52. isKindKey so compara o prefixo, entao
    // home-media/../feed_photo/x.jpg passaria por ele; o regex exige a forma
    // estrutural inteira e recusa a travessia.
    for (const field of IMAGE_FIELDS) {
      const key = input[field];
      if (
        key &&
        (!app.uploads.isKindKey(key, 'home_media') || !HOME_MEDIA_OBJECT_KEY_RE.test(key))
      ) {
        return reply.status(400).send({ error: 'invalid_object_key', field });
      }
    }

    const existing = await ensureHomeContent();

    const data: Prisma.HomeContentUpdateManyMutationInput = {};
    const touched: string[] = [];
    for (const field of CONTENT_FIELDS) {
      const next = input[field];
      if (next !== undefined && next !== existing[field]) {
        (data as Record<string, unknown>)[field] = next;
        touched.push(field);
      }
    }

    // Nada mudou: nao bumpa updatedAt, nao audita. Sai antes da precondicao de
    // proposito, para um Salvar sem alteracao nao dar 409 por corrida alheia.
    if (touched.length === 0) {
      return serializeAdminHomeContent(app, existing);
    }

    if (existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      return reply.status(409).send({ error: 'stale_write' });
    }

    // updateMany porque update nao aceita updatedAt no where. count === 0
    // significa que outra escrita entrou entre o read e este ponto.
    const written = await prisma.homeContent.updateMany({
      where: { id: HOME_CONTENT_SINGLETON_ID, updatedAt: existing.updatedAt },
      data,
    });
    if (written.count === 0) {
      return reply.status(409).send({ error: 'stale_write' });
    }

    const updated = await prisma.homeContent.findUniqueOrThrow({
      where: { id: HOME_CONTENT_SINGLETON_ID },
    });

    // O entityId e um singleton que o proximo save sobrescreve, entao so os
    // nomes dos campos nao respondem "quem pos aquela imagem na home e o que
    // havia antes". Texto fica de fora: institutionalBody tem 1000 chars.
    const images: Record<string, { previous: string | null; next: string | null }> = {};
    for (const field of IMAGE_FIELDS) {
      if (touched.includes(field)) {
        images[field] = { previous: existing[field], next: updated[field] };
      }
    }

    await recordAudit({
      actorId: sub,
      action: 'home_content.update',
      entityType: 'home_content',
      entityId: HOME_CONTENT_SINGLETON_ID,
      metadata: { fields: touched, images },
    });

    return serializeAdminHomeContent(app, updated);
  });
};
