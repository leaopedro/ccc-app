'use server';
import type { SupportTicketInternalStatus } from '@jdm/shared/support';
import { revalidatePath } from 'next/cache';

import { closeAdminSupportTicket, updateAdminSupportTicketInternalStatus } from './admin-api';

export async function closeSupportTicketAction(ticketId: string): Promise<void> {
  await closeAdminSupportTicket(ticketId);
  revalidatePath('/support');
  revalidatePath(`/support/${ticketId}`);
}

export async function updateInternalStatusAction(
  ticketId: string,
  internalStatus: SupportTicketInternalStatus,
): Promise<void> {
  await updateAdminSupportTicketInternalStatus(ticketId, internalStatus);
  revalidatePath(`/support/${ticketId}`);
}
