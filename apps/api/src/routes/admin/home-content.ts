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

import type { HomeContent as DbHomeContent } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

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
};
