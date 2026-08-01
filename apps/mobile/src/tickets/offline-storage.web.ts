import { brand } from '@ccc/design';
import { myTicketSchema, type MyTicket } from '@ccc/shared/tickets';
import { z } from 'zod';

const STORAGE_KEY = `@${brand.app.storagePrefix}/tickets/offline-store/v1`;

const snapshotSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().datetime(),
  ticket: myTicketSchema,
});

type Snapshot = z.infer<typeof snapshotSchema>;

const storeSchema = z.record(z.string(), snapshotSchema);

function loadStore(): Record<string, Snapshot> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    const result = storeSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function persistStore(store: Record<string, Snapshot>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listSavedTickets(): Promise<MyTicket[]> {
  return Promise.resolve(Object.values(loadStore()).map((s) => s.ticket));
}

export function getSavedTicket(ticketId: string): Promise<MyTicket | null> {
  return Promise.resolve(loadStore()[ticketId]?.ticket ?? null);
}

export function isTicketSaved(ticketId: string): Promise<boolean> {
  return Promise.resolve(ticketId in loadStore());
}

export function saveTicket(ticket: MyTicket): Promise<void> {
  const store = loadStore();
  store[ticket.id] = {
    version: 1,
    savedAt: new Date().toISOString(),
    ticket,
  };
  persistStore(store);
  return Promise.resolve();
}

export function removeSavedTicket(ticketId: string): Promise<void> {
  const store = loadStore();
  delete store[ticketId];
  persistStore(store);
  return Promise.resolve();
}
