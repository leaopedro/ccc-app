import { prisma } from '@jdm/db';
import {
  checkInEventsResponseSchema,
  extraClaimRequestSchema,
  extraClaimResponseSchema,
  pickupVoucherClaimRequestSchema,
  pickupVoucherClaimResponseSchema,
  ticketCheckInRequestSchema,
  ticketCheckInResponseSchema,
} from '@jdm/shared/check-in';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { computeIsPremiumActive } from '../../services/garage/index.js';
import { getPickupOrdersForTicket } from '../../services/store/pickup-collect.js';
import {
  claimPickupVoucher,
  InvalidVoucherCodeError,
  VoucherNotFoundError,
  VoucherRevokedError,
  VoucherWrongEventError,
} from '../../services/store/pickup-voucher.js';
import {
  checkInTicket,
  InvalidTicketCodeError,
  TicketNotFoundError,
  TicketRevokedError,
  TicketWrongEventError,
} from '../../services/tickets/check-in.js';
import {
  claimExtra,
  ExtraItemNotFoundError,
  ExtraItemRevokedError,
  ExtraWrongEventError,
  InvalidExtraCodeError,
} from '../../services/tickets/claim-extra.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminCheckInRoutes: FastifyPluginAsync = async (app) => {
  app.post('/tickets/check-in', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const input = ticketCheckInRequestSchema.parse(request.body);

    try {
      const outcome = await checkInTicket(input, app.env);

      if (outcome.kind === 'admitted') {
        await recordAudit({
          actorId,
          action: 'ticket.check_in',
          entityType: 'ticket',
          entityId: outcome.ticket.id,
          metadata: { eventId: input.eventId },
        });
      }

      const checkedInAt =
        outcome.kind === 'admitted'
          ? outcome.checkedInAt.toISOString()
          : outcome.originalUsedAt.toISOString();

      const extraItems = await prisma.ticketExtraItem.findMany({
        where: { ticketId: outcome.ticket.id },
        include: { extra: { select: { name: true } } },
        orderBy: { extra: { sortOrder: 'asc' } },
      });

      const storePickup = await getPickupOrdersForTicket(
        outcome.ticket.id,
        app.env.FIELD_ENCRYPTION_KEY,
      );

      const { car } = outcome.ticket;
      const holderGarage = outcome.ticket.user.garage ?? null;
      const holderIsPremium =
        holderGarage === null
          ? false
          : computeIsPremiumActive(holderGarage.premiumTier, holderGarage.premiumUntil);
      return reply.send(
        ticketCheckInResponseSchema.parse({
          result: outcome.kind,
          ticket: {
            id: outcome.ticket.id,
            status: outcome.ticket.status,
            checkedInAt,
            tier: {
              id: outcome.ticket.tier.id,
              name: outcome.ticket.tier.name,
            },
            holder: {
              id: outcome.ticket.user.id,
              name: outcome.ticket.user.name,
            },
            car: car
              ? {
                  make: car.make,
                  model: car.model,
                  year: car.year,
                  isPremiumActive: holderIsPremium,
                }
              : null,
            licensePlate: outcome.ticket.licensePlate,
            extras: extraItems.map((ei) => ({
              id: ei.id,
              extraId: ei.extraId,
              name: ei.extra.name,
              code: ei.code,
              status: ei.status,
              usedAt: ei.usedAt?.toISOString() ?? null,
            })),
          },
          storePickup,
        }),
      );
    } catch (err) {
      if (err instanceof InvalidTicketCodeError) {
        return reply.status(400).send({ error: 'InvalidTicketCode', message: err.message });
      }
      if (err instanceof TicketNotFoundError) {
        return reply.status(404).send({ error: 'TicketNotFound', message: err.message });
      }
      if (err instanceof TicketWrongEventError) {
        return reply.status(409).send({ error: 'TicketWrongEvent', message: err.message });
      }
      if (err instanceof TicketRevokedError) {
        return reply.status(409).send({ error: 'TicketRevoked', message: err.message });
      }
      throw err;
    }
  });

  app.post('/extras/claim', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const input = extraClaimRequestSchema.parse(request.body);

    try {
      const outcome = await claimExtra(input, app.env);

      if (outcome.kind === 'claimed') {
        await recordAudit({
          actorId,
          action: 'extra.claim',
          entityType: 'ticket_extra_item',
          entityId: outcome.item.id,
          metadata: { eventId: input.eventId, extraId: outcome.item.extraId },
        });
      }

      const usedAt =
        outcome.kind === 'claimed'
          ? outcome.claimedAt.toISOString()
          : outcome.originalUsedAt.toISOString();

      return reply.send(
        extraClaimResponseSchema.parse({
          result: outcome.kind,
          item: {
            id: outcome.item.id,
            extraId: outcome.item.extraId,
            name: outcome.item.extraName,
            status: outcome.item.status,
            usedAt,
            holder: outcome.item.ticket.user,
            tier: outcome.item.ticket.tier,
          },
        }),
      );
    } catch (err) {
      if (err instanceof InvalidExtraCodeError) {
        return reply.status(400).send({ error: 'InvalidExtraCode', message: err.message });
      }
      if (err instanceof ExtraItemNotFoundError) {
        return reply.status(404).send({ error: 'ExtraItemNotFound', message: err.message });
      }
      if (err instanceof ExtraWrongEventError) {
        return reply.status(409).send({ error: 'ExtraWrongEvent', message: err.message });
      }
      if (err instanceof ExtraItemRevokedError) {
        return reply.status(409).send({ error: 'ExtraItemRevoked', message: err.message });
      }
      throw err;
    }
  });

  app.post('/store/pickup/voucher/claim', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const input = pickupVoucherClaimRequestSchema.parse(request.body);

    try {
      const outcome = await claimPickupVoucher(
        { code: input.code, eventId: input.eventId, actorUserId: actorId },
        app.env,
      );

      if (outcome.kind === 'claimed') {
        await recordAudit({
          actorId,
          action: 'store.pickup_voucher.claim',
          entityType: 'pickup_voucher',
          entityId: outcome.item.id,
          metadata: {
            eventId: input.eventId,
            orderId: outcome.item.orderId,
            orderItemId: outcome.item.orderItemId,
          },
        });
      }

      const usedAt =
        outcome.kind === 'claimed'
          ? outcome.claimedAt.toISOString()
          : outcome.originalUsedAt.toISOString();

      return reply.send(
        pickupVoucherClaimResponseSchema.parse({
          result: outcome.kind,
          voucher: {
            id: outcome.item.id,
            orderId: outcome.item.orderId,
            orderShortId: outcome.item.orderId.slice(-8).toUpperCase(),
            status: outcome.item.status,
            usedAt,
            product: outcome.item.product,
            holder: outcome.item.holder,
            ticket: outcome.item.ticket,
          },
        }),
      );
    } catch (err) {
      if (err instanceof InvalidVoucherCodeError) {
        return reply.status(400).send({ error: 'InvalidVoucherCode', message: err.message });
      }
      if (err instanceof VoucherNotFoundError) {
        return reply.status(404).send({ error: 'VoucherNotFound', message: err.message });
      }
      if (err instanceof VoucherWrongEventError) {
        return reply.status(409).send({ error: 'VoucherWrongEvent', message: err.message });
      }
      if (err instanceof VoucherRevokedError) {
        return reply.status(409).send({ error: 'VoucherRevoked', message: err.message });
      }
      throw err;
    }
  });

  app.get('/check-in/events', async (_request, reply) => {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const events = await prisma.event.findMany({
      where: {
        status: 'published',
        endsAt: { gte: cutoff },
      },
      orderBy: [{ startsAt: 'asc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        startsAt: true,
        endsAt: true,
        venueName: true,
        city: true,
        stateCode: true,
      },
    });

    return reply.send(
      checkInEventsResponseSchema.parse({
        items: events.map((e) => ({
          id: e.id,
          slug: e.slug,
          title: e.title,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          venueName: e.venueName,
          city: e.city,
          stateCode: e.stateCode,
        })),
      }),
    );
  });
};
