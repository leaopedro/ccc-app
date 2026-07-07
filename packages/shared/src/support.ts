import { z } from 'zod';

// ----------- user-facing schemas -----------

export const createSupportTicketBodySchema = z.object({
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(10).max(11)),
  message: z.string().min(1).max(2000),
  attachmentObjectKey: z.string().min(1).max(500).optional(),
});
export type CreateSupportTicketBody = z.infer<typeof createSupportTicketBodySchema>;

export const supportTicketStatusSchema = z.enum(['open', 'closed']);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

export const supportTicketInternalStatusSchema = z.enum(['unread', 'seen', 'in_progress', 'done']);
export type SupportTicketInternalStatus = z.infer<typeof supportTicketInternalStatusSchema>;

export const updateInternalStatusBodySchema = z.object({
  internalStatus: supportTicketInternalStatusSchema,
});
export type UpdateInternalStatusBody = z.infer<typeof updateInternalStatusBodySchema>;

export const supportTicketSchema = z.object({
  id: z.string(),
  phone: z.string(),
  message: z.string(),
  attachmentUrl: z.string().url().nullable(),
  status: supportTicketStatusSchema,
  createdAt: z.string().datetime(),
});
export type SupportTicket = z.infer<typeof supportTicketSchema>;

// ----------- admin-facing schemas -----------

export const adminSupportTicketUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const adminSupportTicketListItemSchema = z.object({
  id: z.string(),
  phone: z.string(),
  message: z.string(),
  attachmentUrl: z.string().url().nullable(),
  status: supportTicketStatusSchema,
  internalStatus: supportTicketInternalStatusSchema,
  createdAt: z.string().datetime(),
  user: adminSupportTicketUserSchema,
});
export type AdminSupportTicketListItem = z.infer<typeof adminSupportTicketListItemSchema>;

export const adminSupportTicketDetailSchema = adminSupportTicketListItemSchema.extend({
  closedAt: z.string().datetime().nullable(),
  closedByAdminId: z.string().nullable(),
});
export type AdminSupportTicketDetail = z.infer<typeof adminSupportTicketDetailSchema>;

export const adminSupportTicketListResponseSchema = z.object({
  items: z.array(adminSupportTicketListItemSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type AdminSupportTicketListResponse = z.infer<typeof adminSupportTicketListResponseSchema>;
