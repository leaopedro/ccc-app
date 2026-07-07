import { myTicketSchema, myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { MyTicket, MyTicketsResponse, UpdateTicketRequest } from '@jdm/shared/tickets';

import { authedRequest } from './client';

export const listMyTickets = (): Promise<MyTicketsResponse> =>
  authedRequest('/me/tickets', myTicketsResponseSchema);

export const getMyTicketForEvent = async (eventId: string): Promise<MyTicket | null> => {
  const { items } = await listMyTickets();
  return items.find((t) => t.event.id === eventId && t.status === 'valid') ?? null;
};

export const updateMyTicket = (id: string, body: UpdateTicketRequest): Promise<MyTicket> =>
  authedRequest(`/me/tickets/${id}`, myTicketSchema, { method: 'PATCH', body });
