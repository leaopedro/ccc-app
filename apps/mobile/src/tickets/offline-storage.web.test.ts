// @vitest-environment jsdom
import type { MyTicket } from '@jdm/shared/tickets';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getSavedTicket,
  isTicketSaved,
  listSavedTickets,
  removeSavedTicket,
  saveTicket,
} from './offline-storage.web';

const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

function makeTicket(id: string, overrides: Partial<MyTicket> = {}): MyTicket {
  return {
    id,
    code: `CODE-${id}`,
    status: 'valid',
    source: 'purchase',
    tierName: 'Basic',
    nickname: null,
    usedAt: null,
    createdAt: future,
    event: {
      id: 'evt-1',
      title: 'Track Day',
      slug: 'track-day',
      startsAt: future,
      endsAt: future,
      coverUrl: null,
      venueName: null,
      city: null,
      stateCode: null,
      type: 'meeting' as const,
      status: 'published' as const,
    },
    extras: [],
    pickupOrders: [],
    pickupVouchers: [],
    ...overrides,
  } as MyTicket;
}

describe('offline-storage.web', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('listSavedTickets returns empty array when nothing saved', async () => {
    expect(await listSavedTickets()).toEqual([]);
  });

  it('saveTicket persists ticket and listSavedTickets returns it', async () => {
    await saveTicket(makeTicket('t1'));
    const list = await listSavedTickets();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('t1');
  });

  it('getSavedTicket returns null for unknown id', async () => {
    expect(await getSavedTicket('nope')).toBeNull();
  });

  it('getSavedTicket returns saved ticket by id', async () => {
    await saveTicket(makeTicket('t2', { tierName: 'VIP' }));
    expect((await getSavedTicket('t2'))?.tierName).toBe('VIP');
  });

  it('isTicketSaved returns false when not saved', async () => {
    expect(await isTicketSaved('missing')).toBe(false);
  });

  it('isTicketSaved returns true after saveTicket', async () => {
    await saveTicket(makeTicket('t3'));
    expect(await isTicketSaved('t3')).toBe(true);
  });

  it('removeSavedTicket deletes the ticket', async () => {
    await saveTicket(makeTicket('t4'));
    await removeSavedTicket('t4');
    expect(await isTicketSaved('t4')).toBe(false);
  });

  it('saveTicket overwrites an existing snapshot', async () => {
    await saveTicket(makeTicket('t5', { tierName: 'Basic' }));
    await saveTicket(makeTicket('t5', { tierName: 'VIP' }));
    expect((await getSavedTicket('t5'))?.tierName).toBe('VIP');
  });

  it('listSavedTickets survives corrupt storage gracefully', async () => {
    localStorage.setItem('@jdm/tickets/offline-store/v1', 'not-valid-json{{');
    await expect(listSavedTickets()).resolves.toEqual([]);
  });

  it('listSavedTickets returns empty for invalid snapshot schema', async () => {
    localStorage.setItem(
      '@jdm/tickets/offline-store/v1',
      JSON.stringify({ 't-bad': { version: 1, savedAt: 'not-a-date', ticket: null } }),
    );
    await expect(listSavedTickets()).resolves.toEqual([]);
  });
});
