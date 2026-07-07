import {
  createSupportTicketBodySchema,
  supportTicketSchema,
  type CreateSupportTicketBody,
  type SupportTicket,
} from '@jdm/shared/support';
import { z } from 'zod';

import { authedRequest } from './client';

export const createSupportTicket = (input: CreateSupportTicketBody): Promise<SupportTicket> =>
  authedRequest('/me/support-tickets', supportTicketSchema, {
    method: 'POST',
    body: createSupportTicketBodySchema.parse(input),
  });

export const listOpenSupportTickets = (): Promise<SupportTicket[]> =>
  authedRequest('/me/support-tickets', z.object({ items: z.array(supportTicketSchema) })).then(
    (r) => r.items,
  );
