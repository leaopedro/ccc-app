import { describe, expect, it, vi } from 'vitest';

import { createFridgeRegistry, type FridgeSocket } from '../../src/services/fridge/registry.js';

const log = { info: vi.fn(), warn: vi.fn() };

const fakeSocket = (readyState = 1): FridgeSocket & { sent: string[]; terminated: boolean } => {
  const sent: string[] = [];
  return {
    readyState,
    sent,
    terminated: false,
    send(data: string) {
      sent.push(data);
    },
    ping() {},
    terminate() {
      (this as { terminated: boolean }).terminated = true;
    },
  };
};

describe('fridge registry', () => {
  it('reports offline when no socket registered', () => {
    const reg = createFridgeRegistry({ log });
    expect(reg.isOnline('fridge-01')).toBe(false);
  });

  it('registers a socket and reports online', () => {
    const reg = createFridgeRegistry({ log });
    reg.register('fridge-01', fakeSocket());
    expect(reg.isOnline('fridge-01')).toBe(true);
  });

  it('sendUnlock writes the UNLOCK frame and returns true when online', () => {
    const reg = createFridgeRegistry({ log });
    const s = fakeSocket();
    reg.register('fridge-01', s);
    expect(reg.sendUnlock('fridge-01', 'SECRET')).toBe(true);
    expect(s.sent).toEqual(['UNLOCK:SECRET']);
  });

  it('sendUnlock returns false when offline', () => {
    const reg = createFridgeRegistry({ log });
    expect(reg.sendUnlock('fridge-01', 'SECRET')).toBe(false);
  });

  it('replacing a socket terminates the old one', () => {
    const reg = createFridgeRegistry({ log });
    const oldS = fakeSocket();
    const newS = fakeSocket();
    reg.register('fridge-01', oldS);
    reg.register('fridge-01', newS);
    expect(oldS.terminated).toBe(true);
    expect(reg.isOnline('fridge-01')).toBe(true);
  });

  it('remove only clears when the socket matches', () => {
    const reg = createFridgeRegistry({ log });
    const s = fakeSocket();
    reg.register('fridge-01', s);
    reg.remove('fridge-01', fakeSocket());
    expect(reg.isOnline('fridge-01')).toBe(true);
    reg.remove('fridge-01', s);
    expect(reg.isOnline('fridge-01')).toBe(false);
  });
});
