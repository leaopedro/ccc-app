import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const createAdminBroadcast = vi.fn<(input: unknown) => Promise<unknown>>();
const cancelAdminBroadcast = vi.fn<(id: string) => Promise<unknown>>();
const dryRunAdminBroadcast = vi.fn<(input: unknown) => Promise<{ estimatedRecipients: number }>>();

vi.mock('./admin-api', () => ({
  createAdminBroadcast: (input: unknown) => createAdminBroadcast(input),
  cancelAdminBroadcast: (id: string) => cancelAdminBroadcast(id),
  dryRunAdminBroadcast: (input: unknown) => dryRunAdminBroadcast(input),
}));

import {
  cancelBroadcastAction,
  createBroadcastAction,
  dryRunBroadcastAction,
} from './broadcast-actions';

describe('broadcast-actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T00:00:00.000Z'));
    createAdminBroadcast.mockReset();
    cancelAdminBroadcast.mockReset();
    dryRunAdminBroadcast.mockReset();
    createAdminBroadcast.mockResolvedValue({});
    cancelAdminBroadcast.mockResolvedValue({});
    dryRunAdminBroadcast.mockResolvedValue({ estimatedRecipients: 42 });
    vi.mocked(revalidatePath).mockReset();
  });
  it('creates an immediate broadcast with attendees target', async () => {
    const fd = new FormData();
    fd.set('title', '  Aviso importante  ');
    fd.set('body', '  Chegue cedo  ');
    fd.set('targetKind', 'attendees_of_event');
    fd.set('targetEventId', 'evt_123');
    fd.set('sendTiming', 'now');

    const result = await createBroadcastAction({ error: null, success: null }, fd);

    expect(result).toEqual({
      error: null,
      success: 'Broadcast enviado para processamento.',
    });
    expect(createAdminBroadcast).toHaveBeenCalledWith({
      title: 'Aviso importante',
      body: 'Chegue cedo',
      data: {},
      target: { kind: 'attendees_of_event', eventId: 'evt_123' },
      deliveryMode: 'in_app_plus_push',
      scheduledAt: undefined,
      sendNow: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/broadcasts');
  });

  it('creates a scheduled city broadcast with ISO datetime', async () => {
    const fd = new FormData();
    fd.set('title', 'Comboio');
    fd.set('body', 'Saída às 8h');
    fd.set('targetKind', 'city');
    fd.set('targetCity', '  São Paulo  ');
    fd.set('notificationDeliveryMode', 'in_app_only');
    fd.set('destinationKind', 'internal_path');
    fd.set('destinationInternalPath', '  /eventos/encontro-curitiba  ');
    fd.set('sendTiming', 'schedule');
    fd.set('scheduledAt', '2026-05-13T09:30');
    fd.set('scheduledAtOffsetMinutes', '180');

    const result = await createBroadcastAction({ error: null, success: null }, fd);

    expect(result).toEqual({
      error: null,
      success: 'Broadcast agendado.',
    });
    expect(createAdminBroadcast).toHaveBeenCalledWith({
      title: 'Comboio',
      body: 'Saída às 8h',
      data: {},
      target: { kind: 'city', city: 'São Paulo' },
      deliveryMode: 'in_app_only',
      destination: { kind: 'internal_path', path: '/eventos/encontro-curitiba' },
      scheduledAt: '2026-05-13T12:30:00.000Z',
      sendNow: undefined,
    });
  });

  it('returns validation errors without hitting the API', async () => {
    const fd = new FormData();
    fd.set('title', 'Teste');
    fd.set('body', 'Mensagem');
    fd.set('targetKind', 'city');
    fd.set('targetCity', '');
    fd.set('sendTiming', 'schedule');
    fd.set('scheduledAt', '');
    fd.set('scheduledAtOffsetMinutes', '180');

    const result = await createBroadcastAction({ error: null, success: null }, fd);

    expect(result.error).toBeTruthy();
    expect(createAdminBroadcast).not.toHaveBeenCalled();
  });

  it('rejects scheduled broadcasts in the past', async () => {
    const fd = new FormData();
    fd.set('title', 'Comboio');
    fd.set('body', 'Mensagem');
    fd.set('targetKind', 'all');
    fd.set('sendTiming', 'schedule');
    fd.set('scheduledAt', '2026-05-11T09:30');
    fd.set('scheduledAtOffsetMinutes', '180');

    const result = await createBroadcastAction({ error: null, success: null }, fd);

    expect(result).toEqual({
      error: 'O agendamento deve estar no futuro.',
      success: null,
      values: {
        title: 'Comboio',
        body: 'Mensagem',
        targetKind: 'all',
        sendTiming: 'schedule',
        scheduledAt: '2026-05-11T09:30',
        scheduledAtOffsetMinutes: '180',
      },
    });
    expect(createAdminBroadcast).not.toHaveBeenCalled();
  });

  it('rejects invalid advanced internal paths before hitting the API', async () => {
    const fd = new FormData();
    fd.set('title', 'Comboio');
    fd.set('body', 'Mensagem');
    fd.set('targetKind', 'premium');
    fd.set('destinationKind', 'internal_path');
    fd.set('destinationInternalPath', '../admin');
    fd.set('sendTiming', 'now');

    const result = await createBroadcastAction({ error: null, success: null }, fd);

    expect(result).toEqual({
      error: 'O caminho interno deve começar com /.',
      success: null,
      values: {
        title: 'Comboio',
        body: 'Mensagem',
        targetKind: 'premium',
        destinationKind: 'internal_path',
        destinationInternalPath: '../admin',
        sendTiming: 'now',
      },
    });
    expect(createAdminBroadcast).not.toHaveBeenCalled();
  });

  it('cancels a broadcast and revalidates the page', async () => {
    const result = await cancelBroadcastAction('bc_123');

    expect(result).toEqual({ error: null });
    expect(cancelAdminBroadcast).toHaveBeenCalledWith('bc_123');
    expect(revalidatePath).toHaveBeenCalledWith('/broadcasts');
  });

  it('dry-runs recipient count for a target', async () => {
    const result = await dryRunBroadcastAction({ kind: 'premium' });

    expect(result).toEqual({ ok: true, estimatedRecipients: 42 });
    expect(dryRunAdminBroadcast).toHaveBeenCalledWith({
      target: { kind: 'premium' },
    });
  });
});
