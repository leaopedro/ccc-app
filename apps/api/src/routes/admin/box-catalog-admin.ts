import { prisma } from '@ccc/db';
import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemSchema,
  adminBoxCatalogItemUpdateSchema,
  adminBoxCatalogListSchema,
} from '@ccc/shared/admin-box';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

type Row = Prisma.BoxCatalogItemGetPayload<Record<string, never>>;

const serialize = (row: Row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  description: row.description,
  priceCents: row.priceCents,
  currency: row.currency,
  category: row.category,
  imageObjectKey: row.imageObjectKey,
  stockPerCycle: row.stockPerCycle,
  maxPerCycle: row.maxPerCycle,
  active: row.active,
  sortOrder: row.sortOrder,
});

export const adminBoxCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/catalog-items', async (_request, reply) => {
    const rows = await prisma.boxCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return reply.send(adminBoxCatalogListSchema.parse({ items: rows.map(serialize) }));
  });

  app.post('/box/catalog-items', async (request, reply) => {
    const parsed = adminBoxCatalogItemCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    try {
      const created = await prisma.boxCatalogItem.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          priceCents: input.priceCents,
          category: input.category,
          imageObjectKey: input.imageObjectKey ?? null,
          stockPerCycle: input.stockPerCycle ?? null,
          maxPerCycle: input.maxPerCycle ?? null,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      return reply.status(201).send(adminBoxCatalogItemSchema.parse(serialize(created)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'AlreadyExists', message: 'slug already exists' });
      }
      throw err;
    }
  });

  app.patch('/box/catalog-items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminBoxCatalogItemUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const existing = await prisma.boxCatalogItem.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const input = parsed.data;
    const data: Prisma.BoxCatalogItemUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.category !== undefined) data.category = input.category;
    if (input.imageObjectKey !== undefined) data.imageObjectKey = input.imageObjectKey;
    if (input.stockPerCycle !== undefined) data.stockPerCycle = input.stockPerCycle;
    if (input.maxPerCycle !== undefined) data.maxPerCycle = input.maxPerCycle;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await prisma.boxCatalogItem.update({ where: { id }, data });
    return reply.send(adminBoxCatalogItemSchema.parse(serialize(updated)));
  });

  app.delete('/box/catalog-items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.boxCatalogItem.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const updated = await prisma.boxCatalogItem.update({
      where: { id },
      data: { active: false },
    });
    return reply.send(adminBoxCatalogItemSchema.parse(serialize(updated)));
  });
};
