import { brand } from '@jdm/design';
import { myTicketSchema, type MyTicket } from '@jdm/shared/tickets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

const STORAGE_KEY = `@${brand.app.storagePrefix}/tickets/offline-store/v1`;

const snapshotSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().datetime(),
  ticket: myTicketSchema,
});

type Snapshot = z.infer<typeof snapshotSchema>;

const storeSchema = z.record(z.string(), snapshotSchema);

async function loadStore(): Promise<Record<string, Snapshot>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    const result = storeSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

async function persistStore(store: Record<string, Snapshot>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export async function listSavedTickets(): Promise<MyTicket[]> {
  const store = await loadStore();
  return Object.values(store).map((s) => s.ticket);
}

export async function getSavedTicket(ticketId: string): Promise<MyTicket | null> {
  const store = await loadStore();
  return store[ticketId]?.ticket ?? null;
}

export async function isTicketSaved(ticketId: string): Promise<boolean> {
  const store = await loadStore();
  return ticketId in store;
}

export async function saveTicket(ticket: MyTicket): Promise<void> {
  const store = await loadStore();
  store[ticket.id] = {
    version: 1,
    savedAt: new Date().toISOString(),
    ticket,
  };
  await persistStore(store);
}

export async function removeSavedTicket(ticketId: string): Promise<void> {
  const store = await loadStore();
  delete store[ticketId];
  await persistStore(store);
}
