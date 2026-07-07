import type { MyTicket } from '@jdm/shared/tickets';
import { describe, expect, it } from 'vitest';

import { applyEventFilter, applyStatusFilter, findEventTitle, isExpired } from './filters';

const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

const baseTicket = (override: Partial<MyTicket> & { id: string }): MyTicket =>
  ({
    code: 'A',
    qrPayload: 'x',
    qrSignature: 'x',
    status: 'valid',
    source: 'purchase',
    tierName: 'Basic',
    holderName: 'Alice',
    holderDocument: null,
    extras: [],
    event: {
      id: 'evt-1',
      title: 'Encontro 1',
      slug: 'encontro-1',
      startsAt: future,
      endsAt: future,
      coverUrl: null,
    },
    createdAt: future,
    ...override,
  }) as MyTicket;

describe('isExpired', () => {
  it('treats revoked as expired', () => {
    const t = baseTicket({ id: '1', status: 'revoked' });
    expect(isExpired(t)).toBe(true);
  });

  it('treats valid past-end as expired', () => {
    const t = baseTicket({
      id: '2',
      event: { ...baseTicket({ id: '2' }).event, endsAt: past },
    });
    expect(isExpired(t)).toBe(true);
  });

  it('treats valid future-end as not expired', () => {
    expect(isExpired(baseTicket({ id: '3' }))).toBe(false);
  });
});

describe('applyStatusFilter', () => {
  const items: MyTicket[] = [
    baseTicket({ id: 'valid', status: 'valid' }),
    baseTicket({ id: 'used', status: 'used' }),
    baseTicket({ id: 'revoked', status: 'revoked' }),
  ];

  it('returns everything for "all"', () => {
    expect(applyStatusFilter(items, 'all')).toHaveLength(3);
  });

  it('returns only valid for "valid"', () => {
    expect(applyStatusFilter(items, 'valid').map((t) => t.id)).toEqual(['valid']);
  });

  it('returns only used for "used"', () => {
    expect(applyStatusFilter(items, 'used').map((t) => t.id)).toEqual(['used']);
  });

  it('returns expired (revoked + past) for "expired"', () => {
    expect(applyStatusFilter(items, 'expired').map((t) => t.id)).toEqual(['revoked']);
  });
});

describe('applyEventFilter', () => {
  const items: MyTicket[] = [
    baseTicket({ id: 't1', event: { ...baseTicket({ id: 't1' }).event, id: 'evt-1' } }),
    baseTicket({
      id: 't2',
      event: { ...baseTicket({ id: 't2' }).event, id: 'evt-2', title: 'Encontro 2' },
    }),
  ];

  it('returns all items when eventId is null', () => {
    expect(applyEventFilter(items, null)).toHaveLength(2);
  });

  it('filters by event id', () => {
    expect(applyEventFilter(items, 'evt-2').map((t) => t.id)).toEqual(['t2']);
  });

  it('returns empty when no match', () => {
    expect(applyEventFilter(items, 'nope')).toEqual([]);
  });
});

describe('findEventTitle', () => {
  const items: MyTicket[] = [
    baseTicket({
      id: 't1',
      event: { ...baseTicket({ id: 't1' }).event, id: 'evt-9', title: 'Track Day' },
    }),
  ];

  it('returns null when eventId is null', () => {
    expect(findEventTitle(items, null)).toBeNull();
  });

  it('returns title for matched event', () => {
    expect(findEventTitle(items, 'evt-9')).toBe('Track Day');
  });

  it('returns null when no ticket matches', () => {
    expect(findEventTitle(items, 'evt-x')).toBeNull();
  });
});
