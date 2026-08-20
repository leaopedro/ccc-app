// @vitest-environment jsdom
//
// useMemberHomeData tests (fix round 1, Critical 1). This is the file the
// task-11 report flagged as unpinned: MemberHome.test.tsx mocks this hook
// away entirely, so nothing committed exercised its own fetch/gate/loop
// behavior. No `@testing-library/react` dep in this package — reuse the
// `createRoot` + probe-component + `flush` pattern from
// `apps/mobile/src/screens/garage/__tests__/useBuySpotFlow.test.tsx`.
//
// Each of the six `~/api/*` modules is mocked independently so a test can
// resolve or reject exactly one of them without touching the others.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { GarageReadResponse } from '~/api/garage';
import type * as UseMemberHomeDataModule from '../useMemberHomeData';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getProfileMock = vi.fn();
const listEventsMock = vi.fn();
const listMyTicketsMock = vi.fn();
const getGarageMock = vi.fn();
const getPremiumStatusMock = vi.fn();
const getBoxMock = vi.fn();

vi.mock('~/api/profile', () => ({ getProfile: () => getProfileMock() }));
vi.mock('~/api/events', () => ({ listEvents: () => listEventsMock() }));
vi.mock('~/api/tickets', () => ({ listMyTickets: () => listMyTicketsMock() }));
vi.mock('~/api/garage', () => ({ getGarage: () => getGarageMock() }));
vi.mock('~/api/premium', () => ({ getPremiumStatus: () => getPremiumStatusMock() }));
vi.mock('~/api/box', () => ({ getBox: () => getBoxMock() }));

const ISO = '2026-01-01T00:00:00.000Z';

const PROFILE = {
  id: 'u_1',
  email: 'ana@example.com',
  name: 'Ana Souza',
  role: 'user',
  emailVerifiedAt: ISO,
  createdAt: ISO,
  bio: null,
  city: null,
  stateCode: null,
  avatarUrl: null,
  cpf: null,
  phone: null,
};

const makeGarage = (isPremiumActive: boolean): GarageReadResponse =>
  ({
    garage: {
      id: 'g_1',
      name: 'Garagem',
      slug: 'user-abc12345',
      description: null,
      isPublic: false,
      premiumTier: null,
      premiumUntil: null,
      isPremiumActive,
      coverPreset: null,
      coverImageObjectKey: null,
      coverImageUrl: null,
      daysLeftUntilExpiry: null,
      createdAt: ISO,
      updatedAt: ISO,
      gamification: { enabled: true },
      badges: [],
    },
    cars: [],
    spots: [],
    availableSlots: 0,
    freeLimit: 1,
    isUnlimited: false,
    gamification: { enabled: true },
  }) as unknown as GarageReadResponse;

const PREMIUM = { active: false, tier: null, cadence: null, provider: null };
const BOX = { id: 'box_1', status: 'open' };

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let container: HTMLDivElement;
let root: Root;
type HookApi = ReturnType<typeof UseMemberHomeDataModule.useMemberHomeData>;
const apiRef: { current: HookApi | null } = { current: null };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  [
    getProfileMock,
    listEventsMock,
    listMyTicketsMock,
    getGarageMock,
    getPremiumStatusMock,
    getBoxMock,
  ].forEach((m) => m.mockReset());
  apiRef.current = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getProfileMock.mockResolvedValue(PROFILE);
  listEventsMock.mockResolvedValue({ items: [] });
  listMyTicketsMock.mockResolvedValue({ items: [] });
  getPremiumStatusMock.mockResolvedValue(PREMIUM);
  getBoxMock.mockResolvedValue(BOX);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
  vi.clearAllMocks();
});

// Probe captures the hook's return value into apiRef every render — no
// @testing-library/react. Re-mounted after the vi.mock calls above have
// already registered, via a dynamic import (mirrors useBuySpotFlow.test.tsx).
const mount = async () => {
  const { useMemberHomeData } = await import('../useMemberHomeData');
  const Probe = () => {
    apiRef.current = useMemberHomeData();
    return null;
  };
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
  return apiRef as { current: HookApi };
};

const flushMany = async (times: number) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await flush();
    });
  }
};

it('non-premium garage: no getBox call, each source resolves exactly once', async () => {
  getGarageMock.mockResolvedValue(makeGarage(false));
  const api = await mount();
  // Catches both required invariants at once, per the review: a re-fetch
  // loop would make one of these counts grow past 1 across the repeated
  // flushes below (the exact task-9 shape), and a dropped gate would make
  // getBox get called at all.
  await flushMany(6);
  expect(api.current.profile.data).toEqual(PROFILE);
  expect(getProfileMock).toHaveBeenCalledTimes(1);
  expect(listEventsMock).toHaveBeenCalledTimes(1);
  expect(listMyTicketsMock).toHaveBeenCalledTimes(1);
  expect(getGarageMock).toHaveBeenCalledTimes(1);
  expect(getPremiumStatusMock).toHaveBeenCalledTimes(1);
  expect(getBoxMock).not.toHaveBeenCalled();
  // Box must not be stuck in a permanent loading state (Important 4): the
  // gate resolving negatively still has to settle `box.loading` to false.
  expect(api.current.box).toEqual({ data: null, loading: false, error: false });
});

it('premium garage: calls getBox exactly once across many flushes', async () => {
  getGarageMock.mockResolvedValue(makeGarage(true));
  const api = await mount();
  await flushMany(6);
  expect(getGarageMock).toHaveBeenCalledTimes(1);
  // The core task-9-trap assertion: exactly one call, not N calls growing
  // with the number of flushes/re-renders after the gate opens.
  expect(getBoxMock).toHaveBeenCalledTimes(1);
  expect(api.current.box.data).toEqual(BOX);
});

it('isolates a garage failure: profile/tickets still resolve, garage.error true', async () => {
  getGarageMock.mockRejectedValue(new Error('boom'));
  const api = await mount();
  await flushMany(6);
  expect(api.current.garage.error).toBe(true);
  expect(api.current.garage.data).toBeNull();
  // Catches: a shared `Promise.all` that would let a garage rejection take
  // the other independent sources down with it.
  expect(api.current.profile.data).not.toBeNull();
  expect(api.current.tickets.data).not.toBeNull();
  expect(getBoxMock).not.toHaveBeenCalled();
});
