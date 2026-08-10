import { prisma } from '@ccc/db';
import {
  adminPartnerCreateSchema,
  adminPartnerListSchema,
  adminPartnerModuleCreateSchema,
  adminPartnerModuleSchema,
  adminPartnerModuleUpdateSchema,
  adminPartnerSchema,
  adminPartnerUpdateSchema,
} from '@ccc/shared/admin-box';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import type { Uploads } from '../../services/uploads/types.js';

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

const PARTNER_INCLUDE = {
  modules: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'desc' as const }] },
} satisfies Prisma.PartnerInclude;

type PartnerRow = Prisma.PartnerGetPayload<{ include: typeof PARTNER_INCLUDE }>;
type ModuleRow = PartnerRow['modules'][number];

const serializeModule = (m: ModuleRow, uploads: Uploads) => ({
  id: m.id,
  partnerId: m.partnerId,
  name: m.name,
  description: m.description,
  priceCents: m.priceCents,
  currency: m.currency,
  imageObjectKey: m.imageObjectKey,
  imageUrl: m.imageObjectKey ? uploads.buildPublicUrl(m.imageObjectKey) : null,
  active: m.active,
  sortOrder: m.sortOrder,
});

const serializePartner = (p: PartnerRow, uploads: Uploads) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  description: p.description,
  logoObjectKey: p.logoObjectKey,
  logoUrl: p.logoObjectKey ? uploads.buildPublicUrl(p.logoObjectKey) : null,
  active: p.active,
  sortOrder: p.sortOrder,
  modules: p.modules.map((m) => serializeModule(m, uploads)),
});

export const adminBoxPartnersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/partners', async (_request, reply) => {
    const rows = await prisma.partner.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: PARTNER_INCLUDE,
    });
    return reply.send(
      adminPartnerListSchema.parse({ partners: rows.map((r) => serializePartner(r, app.uploads)) }),
    );
  });

  app.post('/box/partners', async (request, reply) => {
    const parsed = adminPartnerCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    if (input.logoObjectKey && !app.uploads.isKindKey(input.logoObjectKey, 'partner_logo')) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid logo object key' });
    }
    try {
      const created = await prisma.partner.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          logoObjectKey: input.logoObjectKey ?? null,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
        include: PARTNER_INCLUDE,
      });
      return reply
        .status(201)
        .send(adminPartnerSchema.parse(serializePartner(created, app.uploads)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'AlreadyExists', message: 'slug already exists' });
      }
      throw err;
    }
  });

  app.patch('/box/partners/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPartnerUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const input = parsed.data;
    if (input.logoObjectKey && !app.uploads.isKindKey(input.logoObjectKey, 'partner_logo')) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid logo object key' });
    }
    const data: Prisma.PartnerUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.logoObjectKey !== undefined) data.logoObjectKey = input.logoObjectKey;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    const updated = await prisma.partner.update({ where: { id }, data, include: PARTNER_INCLUDE });
    return reply.send(adminPartnerSchema.parse(serializePartner(updated, app.uploads)));
  });

  app.delete('/box/partners/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const updated = await prisma.partner.update({
      where: { id },
      data: { active: false },
      include: PARTNER_INCLUDE,
    });
    return reply.send(adminPartnerSchema.parse(serializePartner(updated, app.uploads)));
  });

  app.post('/box/partners/:id/modules', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPartnerModuleCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const partner = await prisma.partner.findUnique({ where: { id } });
    if (!partner) return reply.status(404).send({ error: 'NotFound' });
    const input = parsed.data;
    if (input.imageObjectKey && !app.uploads.isKindKey(input.imageObjectKey, 'partner_module')) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid image object key' });
    }
    const created = await prisma.partnerModule.create({
      data: {
        partnerId: id,
        name: input.name,
        description: input.description ?? null,
        priceCents: input.priceCents,
        imageObjectKey: input.imageObjectKey ?? null,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return reply
      .status(201)
      .send(adminPartnerModuleSchema.parse(serializeModule(created, app.uploads)));
  });

  app.patch('/box/partner-modules/:moduleId', async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    const parsed = adminPartnerModuleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const existing = await prisma.partnerModule.findUnique({ where: { id: moduleId } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const input = parsed.data;
    if (input.imageObjectKey && !app.uploads.isKindKey(input.imageObjectKey, 'partner_module')) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid image object key' });
    }
    const data: Prisma.PartnerModuleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.imageObjectKey !== undefined) data.imageObjectKey = input.imageObjectKey;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    const updated = await prisma.partnerModule.update({ where: { id: moduleId }, data });
    return reply.send(adminPartnerModuleSchema.parse(serializeModule(updated, app.uploads)));
  });

  app.delete('/box/partner-modules/:moduleId', async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    const existing = await prisma.partnerModule.findUnique({ where: { id: moduleId } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const updated = await prisma.partnerModule.update({
      where: { id: moduleId },
      data: { active: false },
    });
    return reply.send(adminPartnerModuleSchema.parse(serializeModule(updated, app.uploads)));
  });
};
