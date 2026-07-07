'use server';

import { getAdminEvent, grantTicket } from './admin-api';
import { ApiError } from './api';

export type EventDetailForGrant = {
  tiers: Array<{ id: string; name: string; requiresCar: boolean }>;
  extras: Array<{ id: string; name: string }>;
};

export const loadEventDetailAction = async (eventId: string): Promise<EventDetailForGrant> => {
  const event = await getAdminEvent(eventId);
  return {
    tiers: event.tiers.map((t) => ({ id: t.id, name: t.name, requiresCar: t.requiresCar })),
    extras: event.extras.map((e) => ({ id: e.id, name: e.name })),
  };
};

export type GrantActionResult = { ok: true; ticketId: string } | { ok: false; error: string };

export const grantTicketAction = async (
  userId: string,
  input: {
    eventId: string;
    tierId: string;
    extras: string[];
    carId?: string;
    licensePlate?: string;
    note?: string;
  },
): Promise<GrantActionResult> => {
  try {
    const result = await grantTicket({ userId, ...input });
    return { ok: true, ticketId: result.ticketId };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};
