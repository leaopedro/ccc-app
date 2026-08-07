import { FRIDGE_DEVICE_ID } from '@ccc/shared/fridge';
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { makeApp } from '../helpers.js';
import type { FridgeSocket } from '../../src/services/fridge/registry.js';

const API_KEY = 'g'.repeat(48); // matches test/setup.ts FRIDGE_UNLOCK_API_KEY

const onlineSocket = (): FridgeSocket & { sent: string[] } => {
  const sent: string[] = [];
  return {
    readyState: 1,
    sent,
    send: (d: string) => sent.push(d),
    ping: () => {},
    terminate: () => {},
  };
};

describe('POST /api/fridge/unlock', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await makeApp();
    await app.ready();
    await prisma.fridgeUnlockEvent.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a missing/invalid api key with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fridge/unlock', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 and logs a failed_offline event when device is offline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fridge/unlock',
      headers: { 'x-api-key': API_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    const events = await prisma.fridgeUnlockEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('failed_offline');
  });

  it('returns 503 and persists failed_offline when socket closes between isOnline and sendUnlock (TOCTOU)', async () => {
    // readyState returns OPEN (1) on the first read (isOnline check), then CLOSED (3) on the
    // second read (sendUnlock check), simulating a socket that dropped between the two calls.
    let readCount = 0;
    const racySocket: FridgeSocket = {
      get readyState() {
        return readCount++ === 0 ? 1 : 3;
      },
      send: () => {},
      ping: () => {},
      terminate: () => {},
    };
    app.fridge.register(FRIDGE_DEVICE_ID, racySocket);

    const res = await app.inject({
      method: 'POST',
      url: '/api/fridge/unlock',
      headers: { 'x-api-key': API_KEY },
      payload: {},
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'ServiceUnavailable', message: 'device offline' });
    const events = await prisma.fridgeUnlockEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('failed_offline');
  });

  it('sends UNLOCK and returns 200 when device is online', async () => {
    const socket = onlineSocket();
    app.fridge.register(FRIDGE_DEVICE_ID, socket);

    const res = await app.inject({
      method: 'POST',
      url: '/api/fridge/unlock',
      headers: { 'x-api-key': API_KEY },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'sent', deviceId: FRIDGE_DEVICE_ID });
    expect(socket.sent).toEqual([`UNLOCK:${'f'.repeat(48)}`]);
    const events = await prisma.fridgeUnlockEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('sent');
  });
});
