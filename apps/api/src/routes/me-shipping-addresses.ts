import { prisma } from '@jdm/db';
import {
  shippingAddressInputSchema,
  shippingAddressRecordSchema,
  shippingAddressUpdateSchema,
  type ShippingAddressRecord,
} from '@jdm/shared/store';
import type { ShippingAddress as DbShippingAddress } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

const serialize = (row: DbShippingAddress): ShippingAddressRecord =>
  shippingAddressRecordSchema.parse({
    id: row.id,
    recipientName: row.recipientName,
    phone: row.phone ?? '',
    postalCode: row.postalCode,
    street: row.line1,
    number: row.number,
    complement: row.line2,
    neighborhood: row.district,
    city: row.city,
    stateCode: row.stateCode,
    countryCode: 'BR',
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

type MappedFields = Partial<{
  recipientName: string;
  phone: string;
  postalCode: string;
  line1: string;
  number: string;
  line2: string | null;
  district: string;
  city: string;
  stateCode: string;
}>;

const mapInputToDb = (input: {
  recipientName?: string | undefined;
  phone?: string | undefined;
  postalCode?: string | undefined;
  street?: string | undefined;
  number?: string | undefined;
  complement?: string | null | undefined;
  neighborhood?: string | undefined;
  city?: string | undefined;
  stateCode?: string | undefined;
}): MappedFields => {
  const data: MappedFields = {};
  if (input.recipientName !== undefined) data.recipientName = input.recipientName;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.street !== undefined) data.line1 = input.street;
  if (input.number !== undefined) data.number = input.number;
  if (input.complement !== undefined) data.line2 = input.complement;
  if (input.neighborhood !== undefined) data.district = input.neighborhood;
  if (input.city !== undefined) data.city = input.city;
  if (input.stateCode !== undefined) data.stateCode = input.stateCode;
  return data;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const meShippingAddressRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/shipping-addresses', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const rows = await prisma.shippingAddress.findMany({
      where: { userId: sub },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return { items: rows.map(serialize) };
  });

  app.post('/me/shipping-addresses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const input = shippingAddressInputSchema.parse(request.body);

    const existingCount = await prisma.shippingAddress.count({ where: { userId: sub } });
    const shouldDefault = input.isDefault === true || existingCount === 0;

    const created = await prisma.$transaction(async (tx) => {
      if (shouldDefault) {
        await tx.shippingAddress.updateMany({
          where: { userId: sub, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.shippingAddress.create({
        data: {
          userId: sub,
          recipientName: input.recipientName,
          phone: input.phone,
          postalCode: input.postalCode,
          line1: input.street,
          number: input.number,
          line2: input.complement ?? null,
          district: input.neighborhood,
          city: input.city,
          stateCode: input.stateCode,
          isDefault: shouldDefault,
        },
      });
    });

    return reply.status(201).send(serialize(created));
  });

  app.patch(
    '/me/shipping-addresses/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { id } = request.params as { id: string };
      const owned = await prisma.shippingAddress.findFirst({ where: { id, userId: sub } });
      if (!owned) return reply.status(404).send({ error: 'NotFound' });

      const input = shippingAddressUpdateSchema.parse(request.body);
      const mapped = mapInputToDb(input);
      const promoteToDefault = input.isDefault === true && !owned.isDefault;
      const demote = input.isDefault === false && owned.isDefault;

      const updated = await prisma.$transaction(async (tx) => {
        if (promoteToDefault) {
          await tx.shippingAddress.updateMany({
            where: { userId: sub, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }
        return tx.shippingAddress.update({
          where: { id },
          data: {
            ...mapped,
            ...(promoteToDefault ? { isDefault: true } : {}),
            ...(demote ? { isDefault: false } : {}),
          },
        });
      });

      return serialize(updated);
    },
  );

  app.delete(
    '/me/shipping-addresses/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { id } = request.params as { id: string };
      const { count } = await prisma.shippingAddress.deleteMany({ where: { id, userId: sub } });
      if (count === 0) return reply.status(404).send({ error: 'NotFound' });
      return reply.status(204).send();
    },
  );
};
