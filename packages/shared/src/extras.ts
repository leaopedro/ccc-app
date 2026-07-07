import { z } from 'zod';

import { capacityDisplayDescriptorSchema } from './general-settings.js';

export const ticketExtraItemStatusSchema = z.enum(['valid', 'used', 'revoked']);
export type TicketExtraItemStatus = z.infer<typeof ticketExtraItemStatusSchema>;

export const ticketExtraSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1).max(140),
  description: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  quantityTotal: z.number().int().positive().nullable(),
  quantitySold: z.number().int().nonnegative(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TicketExtra = z.infer<typeof ticketExtraSchema>;

export const eventExtraPublicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(140),
  description: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  displayPriceCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  currency: z.string().length(3),
  quantityRemaining: z.number().int().nonnegative().nullable(),
  sortOrder: z.number().int(),
  capacityDisplay: capacityDisplayDescriptorSchema,
});
export type EventExtraPublic = z.infer<typeof eventExtraPublicSchema>;

export const orderExtraSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  extraId: z.string().min(1),
  quantity: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type OrderExtra = z.infer<typeof orderExtraSchema>;

export const ticketExtraItemSchema = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  extraId: z.string().min(1),
  code: z.string().min(1),
  status: ticketExtraItemStatusSchema,
  usedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TicketExtraItem = z.infer<typeof ticketExtraItemSchema>;
