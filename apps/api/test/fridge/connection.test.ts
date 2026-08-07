import { describe, expect, it, vi } from 'vitest';

import {
  handleFridgeConnection,
  type FridgeConnectionSocket,
} from '../../src/services/fridge/connection.js';
import { createFridgeRegistry } from '../../src/services/fridge/registry.js';

const log = { info: vi.fn(), warn: vi.fn() };
const DEVICE_ID = 'fridge-01';
const SECRET = 's'.repeat(48);

const fakeSocket = () => {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    readyState: 1,
    closed: null as null | { code?: number; reason?: string },
    send() {},
    ping() {},
    terminate() {},
    close(code?: number, reason?: string) {
      (this as { closed: unknown }).closed = { code, reason };
    },
    on(event: string, cb: (arg?: unknown) => void) {
      handlers[event] = cb;
    },
    fire(event: string, arg?: unknown) {
      handlers[event]?.(arg);
    },
  };
};

describe('handleFridgeConnection', () => {
  it('closes with 4401 when the secret is wrong', () => {
    const reg = createFridgeRegistry({ log });
    const socket = fakeSocket();
    handleFridgeConnection({
      socket: socket as unknown as FridgeConnectionSocket,
      id: DEVICE_ID,
      secret: 'wrong',
      deviceId: DEVICE_ID,
      deviceSecret: SECRET,
      registry: reg,
      log,
    });
    expect(socket.closed?.code).toBe(4401);
    expect(reg.isOnline(DEVICE_ID)).toBe(false);
  });

  it('closes with 4401 when the id is wrong', () => {
    const reg = createFridgeRegistry({ log });
    const socket = fakeSocket();
    handleFridgeConnection({
      socket: socket as unknown as FridgeConnectionSocket,
      id: 'fridge-99',
      secret: SECRET,
      deviceId: DEVICE_ID,
      deviceSecret: SECRET,
      registry: reg,
      log,
    });
    expect(socket.closed?.code).toBe(4401);
    expect(reg.isOnline(DEVICE_ID)).toBe(false);
  });

  it('registers on valid auth and wires pong/close', () => {
    const reg = createFridgeRegistry({ log });
    const socket = fakeSocket();
    handleFridgeConnection({
      socket: socket as unknown as FridgeConnectionSocket,
      id: DEVICE_ID,
      secret: SECRET,
      deviceId: DEVICE_ID,
      deviceSecret: SECRET,
      registry: reg,
      log,
    });
    expect(socket.closed).toBeNull();
    expect(reg.isOnline(DEVICE_ID)).toBe(true);
    socket.fire('close');
    expect(reg.isOnline(DEVICE_ID)).toBe(false);
  });
});
