# Fridge ESP32 WSS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the backend push an unlock command to an ESP32 fridge lock over a secure WebSocket, triggered by a service-authenticated HTTP endpoint.

**Architecture:** The ESP32 holds one persistent `wss://` connection to `GET /ws/fridge`, authenticating with `FRIDGE_DEVICE_SECRET`. An in-process registry tracks that live socket with a heartbeat. `POST /api/fridge/unlock` (service API key) checks the device is online and sends the text frame `UNLOCK:<secret>`, persisting each attempt.

**Tech Stack:** Fastify 5, `@fastify/websocket` `^11` (wraps `ws`), Prisma 6 / Postgres, Zod, Vitest + Testcontainers.

## Global Constraints

- Primary language PT-BR; user-facing copy in the shared locale package. (No user-facing copy in this feature.)
- LGPD compliant: do NOT persist walk-up PII (name/email/phone) without a consent flow. The unlock body accepts these fields but they are not stored this phase.
- Rate limiting on the unlock endpoint (CLAUDE.md requirement).
- Secrets (`FRIDGE_DEVICE_SECRET`, `FRIDGE_UNLOCK_API_KEY`) never reach the frontend and are never logged.
- Single-replica invariant: the registry is in-process memory; correct only at Railway `numReplicas: 1`.
- API integration tests hit a real Postgres via the repo Testcontainers harness, not mocks.
- Branch: `feat/fridge-esp32-wss` (already created from `main`). Never work on `production`.

---

### Task 1: Dependency + environment configuration

**Files:**

- Modify: `apps/api/package.json` (add dependency)
- Modify: `apps/api/src/env.ts` (add two env vars)
- Modify: `apps/api/test/setup.ts` (add test env)

**Interfaces:**

- Produces: `env.FRIDGE_DEVICE_SECRET?: string`, `env.FRIDGE_UNLOCK_API_KEY?: string`

- [ ] **Step 1: Install `@fastify/websocket`**

Run: `pnpm --filter @ccc/api add @fastify/websocket@^11`
Expected: `apps/api/package.json` gains `"@fastify/websocket": "^11.x"`.

- [ ] **Step 2: Add env vars to the schema**

In `apps/api/src/env.ts`, inside `envSchema` (near the other optional secrets, e.g. after `ABACATEPAY_WEBHOOK_SECRET`):

```ts
  FRIDGE_DEVICE_SECRET: z.string().min(32).optional(),
  FRIDGE_UNLOCK_API_KEY: z.string().min(32).optional(),
```

- [ ] **Step 3: Add test env defaults**

In `apps/api/test/setup.ts`, after the `MFA_ENCRYPTION_KEY` line:

```ts
process.env.FRIDGE_DEVICE_SECRET = 'f'.repeat(48);
process.env.FRIDGE_UNLOCK_API_KEY = 'g'.repeat(48);
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS (no usages yet, schema still valid).

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/env.ts apps/api/test/setup.ts
git commit -m "chore(api): add @fastify/websocket and fridge env vars"
```

---

### Task 2: Shared schemas

**Files:**

- Create: `packages/shared/src/fridge.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Modify: `packages/shared/package.json` (subpath export)

**Interfaces:**

- Produces: `FRIDGE_DEVICE_ID: 'fridge-01'`, `fridgeUnlockBodySchema`, `FridgeUnlockBody`, `fridgeUnlockResponseSchema`, `FridgeUnlockResponse` from `@ccc/shared/fridge`.

- [ ] **Step 1: Write the schema module**

Create `packages/shared/src/fridge.ts`:

```ts
import { z } from 'zod';

export const FRIDGE_DEVICE_ID = 'fridge-01' as const;

export const fridgeUnlockBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(3).max(32).optional(),
  })
  .strict();

export type FridgeUnlockBody = z.infer<typeof fridgeUnlockBodySchema>;

export const fridgeUnlockResponseSchema = z.object({
  status: z.literal('sent'),
  deviceId: z.string().min(1),
});

export type FridgeUnlockResponse = z.infer<typeof fridgeUnlockResponseSchema>;
```

- [ ] **Step 2: Re-export from index**

In `packages/shared/src/index.ts`, add a line alongside the other `export *`:

```ts
export * from './fridge.js';
```

- [ ] **Step 3: Add the subpath export**

In `packages/shared/package.json`, inside `"exports"`, add (mirroring the existing `"./health"` entry):

```json
    "./fridge": {
      "types": "./src/fridge.ts",
      "default": "./dist/fridge.js"
    },
```

- [ ] **Step 4: Build shared and verify**

Run: `pnpm --filter @ccc/shared build && pnpm --filter @ccc/shared typecheck`
Expected: PASS; `packages/shared/dist/fridge.js` exists.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fridge.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): add fridge unlock schemas"
```

---

### Task 3: Database model

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (enum + model + User relation)
- Create: `packages/db/prisma/migrations/<timestamp>_fridge_unlock_event/migration.sql` (generated)
- Modify: `apps/api/test/helpers.ts` (reset helper)

**Interfaces:**

- Produces: Prisma model `FridgeUnlockEvent { id, deviceId, userId?, status, createdAt }`, enum `FridgeUnlockStatus { sent, failed_offline }`, accessed as `prisma.fridgeUnlockEvent`.

- [ ] **Step 1: Add the enum and model**

In `packages/db/prisma/schema.prisma`, append:

```prisma
enum FridgeUnlockStatus {
  sent
  failed_offline
}

model FridgeUnlockEvent {
  id        String             @id @default(cuid())
  deviceId  String
  userId    String?
  user      User?              @relation(fields: [userId], references: [id], onDelete: SetNull)
  status    FridgeUnlockStatus
  createdAt DateTime           @default(now())

  @@index([deviceId, createdAt])
  @@index([userId])
}
```

- [ ] **Step 2: Add the reverse relation on User**

In the `model User { ... }` block, add a relation field beside the other `[]` relation fields:

```prisma
  fridgeUnlockEvents FridgeUnlockEvent[]
```

- [ ] **Step 3: Create the migration**

Ensure a local Postgres is up (`docker compose up -d` at repo root), then:
Run: `pnpm --filter @ccc/db db:migrate --name fridge_unlock_event`
Expected: new folder under `packages/db/prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 4: Add to the reset helper**

In `apps/api/test/helpers.ts`, inside `resetDatabase`, add before the ticket/user deletes (child rows first):

```ts
await prisma.fridgeUnlockEvent.deleteMany();
```

- [ ] **Step 5: Verify db typecheck**

Run: `pnpm --filter @ccc/db typecheck`
Expected: PASS; `prisma.fridgeUnlockEvent` is typed.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/test/helpers.ts
git commit -m "feat(db): add FridgeUnlockEvent model"
```

---

### Task 4: Connection registry service

**Files:**

- Create: `apps/api/src/services/fridge/registry.ts`
- Create: `apps/api/src/services/fridge/safe-equal.ts`
- Test: `apps/api/test/fridge/registry.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `safeEqual(a: string, b: string): boolean`
  - `interface FridgeSocket { readyState: number; send(data: string): void; ping(): void; terminate(): void; }`
  - `interface FridgeRegistry { register(id, socket): void; markAlive(id): void; isOnline(id): boolean; sendUnlock(id, secret): boolean; remove(id, socket): void; stopHeartbeat(): void; }`
  - `createFridgeRegistry(deps: { heartbeatMs?: number; log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } }): FridgeRegistry`
  - Socket `readyState === 1` means OPEN.

- [ ] **Step 1: Write the constant-time compare helper**

Create `apps/api/src/services/fridge/safe-equal.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';

export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};
```

- [ ] **Step 2: Write the failing registry test**

Create `apps/api/test/fridge/registry.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- registry`
Expected: FAIL — cannot find `registry.js`.

- [ ] **Step 4: Write the registry implementation**

Create `apps/api/src/services/fridge/registry.ts`:

```ts
type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export interface FridgeSocket {
  readyState: number;
  send(data: string): void;
  ping(): void;
  terminate(): void;
}

export interface FridgeRegistry {
  register(deviceId: string, socket: FridgeSocket): void;
  markAlive(deviceId: string): void;
  isOnline(deviceId: string): boolean;
  sendUnlock(deviceId: string, secret: string): boolean;
  remove(deviceId: string, socket: FridgeSocket): void;
  stopHeartbeat(): void;
}

export interface FridgeRegistryDeps {
  heartbeatMs?: number;
  log: Logger;
}

const OPEN = 1;

export const createFridgeRegistry = (deps: FridgeRegistryDeps): FridgeRegistry => {
  const entries = new Map<string, { socket: FridgeSocket; alive: boolean }>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const registry: FridgeRegistry = {
    register(deviceId, socket) {
      const existing = entries.get(deviceId);
      if (existing && existing.socket !== socket) existing.socket.terminate();
      entries.set(deviceId, { socket, alive: true });
    },
    markAlive(deviceId) {
      const entry = entries.get(deviceId);
      if (entry) entry.alive = true;
    },
    isOnline(deviceId) {
      const entry = entries.get(deviceId);
      return Boolean(entry) && entry!.socket.readyState === OPEN;
    },
    sendUnlock(deviceId, secret) {
      const entry = entries.get(deviceId);
      if (!entry || entry.socket.readyState !== OPEN) return false;
      entry.socket.send(`UNLOCK:${secret}`);
      return true;
    },
    remove(deviceId, socket) {
      const entry = entries.get(deviceId);
      if (entry && entry.socket === socket) entries.delete(deviceId);
    },
    stopHeartbeat() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };

  const heartbeatMs = deps.heartbeatMs ?? 0;
  if (heartbeatMs > 0) {
    timer = setInterval(() => {
      for (const [deviceId, entry] of entries) {
        if (!entry.alive) {
          deps.log.warn({ deviceId }, '[fridge] heartbeat timeout, terminating');
          entry.socket.terminate();
          entries.delete(deviceId);
          continue;
        }
        entry.alive = false;
        entry.socket.ping();
      }
    }, heartbeatMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return registry;
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- registry`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/fridge/registry.ts apps/api/src/services/fridge/safe-equal.ts apps/api/test/fridge/registry.test.ts
git commit -m "feat(api): add fridge connection registry"
```

---

### Task 5: Connection handler

**Files:**

- Create: `apps/api/src/services/fridge/connection.ts`
- Test: `apps/api/test/fridge/connection.test.ts`

**Interfaces:**

- Consumes: `FridgeRegistry`, `FridgeSocket` (Task 4).
- Produces:
  - `interface FridgeConnectionSocket extends FridgeSocket { on(event, cb): void; close(code?: number, reason?: string): void; }`
  - `handleFridgeConnection(args: { socket: FridgeConnectionSocket; id?: string; secret?: string; deviceId: string; deviceSecret: string; registry: FridgeRegistry; log: Logger }): void`
  - On bad auth: `socket.close(4401, 'unauthorized')` and no registration.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/fridge/connection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- connection`
Expected: FAIL — cannot find `connection.js`.

- [ ] **Step 3: Write the handler**

Create `apps/api/src/services/fridge/connection.ts`:

```ts
import type { FridgeRegistry, FridgeSocket } from './registry.js';
import { safeEqual } from './safe-equal.js';

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export interface FridgeConnectionSocket extends FridgeSocket {
  on(event: 'pong' | 'message' | 'close', cb: (arg?: unknown) => void): void;
  close(code?: number, reason?: string): void;
}

export interface HandleFridgeConnectionArgs {
  socket: FridgeConnectionSocket;
  id: string | undefined;
  secret: string | undefined;
  deviceId: string;
  deviceSecret: string;
  registry: FridgeRegistry;
  log: Logger;
}

export const handleFridgeConnection = (args: HandleFridgeConnectionArgs): void => {
  const { socket, id, secret, deviceId, deviceSecret, registry, log } = args;

  if (!id || id !== deviceId || !secret || !safeEqual(secret, deviceSecret)) {
    log.warn({ deviceId: id ?? null }, '[fridge-ws] rejected connection');
    socket.close(4401, 'unauthorized');
    return;
  }

  registry.register(id, socket);
  log.info({ deviceId: id }, '[fridge-ws] connected');

  socket.on('pong', () => registry.markAlive(id));
  socket.on('message', (raw) =>
    log.info({ deviceId: id, msg: String(raw).slice(0, 64) }, '[fridge-ws] message'),
  );
  socket.on('close', () => {
    registry.remove(id, socket);
    log.info({ deviceId: id }, '[fridge-ws] disconnected');
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- connection`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/fridge/connection.ts apps/api/test/fridge/connection.test.ts
git commit -m "feat(api): add fridge ws connection handler"
```

---

### Task 6: Routes + app wiring + integration test

**Files:**

- Create: `apps/api/src/routes/fridge-ws.ts`
- Create: `apps/api/src/routes/fridge-unlock.ts`
- Modify: `apps/api/src/app.ts` (decorate registry, gated registration, onClose)
- Test: `apps/api/test/fridge/unlock.route.test.ts`

**Interfaces:**

- Consumes: `createFridgeRegistry`, `FridgeRegistry` (Task 4); `handleFridgeConnection`, `FridgeConnectionSocket` (Task 5); `safeEqual` (Task 4); `FRIDGE_DEVICE_ID`, `fridgeUnlockBodySchema` (Task 2); `prisma.fridgeUnlockEvent` (Task 3).
- Produces: `app.fridge: FridgeRegistry` decoration; routes `GET /ws/fridge`, `POST /api/fridge/unlock`.

- [ ] **Step 1: Write the WS route**

Create `apps/api/src/routes/fridge-ws.ts`:

```ts
import { FRIDGE_DEVICE_ID } from '@ccc/shared/fridge';
import websocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';

import {
  handleFridgeConnection,
  type FridgeConnectionSocket,
} from '../services/fridge/connection.js';

// Single-replica invariant: app.fridge is in-process memory. Correct only at
// Railway numReplicas=1. Scaling out needs shared connection state.
export const fridgeWsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  app.get('/ws/fridge', { websocket: true }, (socket, req) => {
    const { id, secret } = req.query as { id?: string; secret?: string };
    handleFridgeConnection({
      socket: socket as unknown as FridgeConnectionSocket,
      id,
      secret,
      deviceId: FRIDGE_DEVICE_ID,
      deviceSecret: app.env.FRIDGE_DEVICE_SECRET ?? '',
      registry: app.fridge,
      log: app.log,
    });
  });
};
```

- [ ] **Step 2: Write the unlock route**

Create `apps/api/src/routes/fridge-unlock.ts`:

```ts
import { prisma } from '@ccc/db';
import { FRIDGE_DEVICE_ID, fridgeUnlockBodySchema } from '@ccc/shared/fridge';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { safeEqual } from '../services/fridge/safe-equal.js';

export const fridgeUnlockRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      keyGenerator: (req) => `fridge-unlock:${req.ip}`,
    });

    scoped.post('/api/fridge/unlock', async (request, reply) => {
      const apiKey = request.headers['x-api-key'];
      const expected = app.env.FRIDGE_UNLOCK_API_KEY ?? '';
      if (typeof apiKey !== 'string' || expected.length === 0 || !safeEqual(apiKey, expected)) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'invalid api key' });
      }

      // Body accepted for future user association; PII not persisted yet (LGPD).
      fridgeUnlockBodySchema.parse(request.body ?? {});

      if (!app.fridge.isOnline(FRIDGE_DEVICE_ID)) {
        await prisma.fridgeUnlockEvent.create({
          data: { deviceId: FRIDGE_DEVICE_ID, status: 'failed_offline' },
        });
        app.log.warn({ deviceId: FRIDGE_DEVICE_ID }, '[fridge-unlock] device offline');
        return reply.status(503).send({ error: 'ServiceUnavailable', message: 'device offline' });
      }

      app.fridge.sendUnlock(FRIDGE_DEVICE_ID, app.env.FRIDGE_DEVICE_SECRET ?? '');
      await prisma.fridgeUnlockEvent.create({
        data: { deviceId: FRIDGE_DEVICE_ID, status: 'sent' },
      });
      app.log.info({ deviceId: FRIDGE_DEVICE_ID }, '[fridge-unlock] unlock sent');
      return reply.status(200).send({ status: 'sent', deviceId: FRIDGE_DEVICE_ID });
    });
  });
};
```

- [ ] **Step 3: Wire into app.ts**

In `apps/api/src/app.ts`:

Add imports beside the other route/service imports:

```ts
import { fridgeUnlockRoutes } from './routes/fridge-unlock.js';
import { fridgeWsRoutes } from './routes/fridge-ws.js';
import { createFridgeRegistry, type FridgeRegistry } from './services/fridge/registry.js';
```

Add to the `declare module 'fastify'` `FastifyInstance` interface:

```ts
fridge: FridgeRegistry;
```

After the existing `app.decorate('push', ...)` line, decorate the registry and stop its heartbeat on close:

```ts
app.decorate('fridge', createFridgeRegistry({ heartbeatMs: 30_000, log: app.log }));
app.addHook('onClose', () => {
  app.fridge.stopHeartbeat();
});
```

After the last `await app.register(...)` route line (before the worker section), register the routes gated on both secrets:

```ts
if (env.FRIDGE_DEVICE_SECRET && env.FRIDGE_UNLOCK_API_KEY) {
  await app.register(fridgeWsRoutes);
  await app.register(fridgeUnlockRoutes);
} else {
  app.log.warn(
    {
      FRIDGE_DEVICE_SECRET: Boolean(env.FRIDGE_DEVICE_SECRET),
      FRIDGE_UNLOCK_API_KEY: Boolean(env.FRIDGE_UNLOCK_API_KEY),
    },
    '[fridge] disabled — set FRIDGE_DEVICE_SECRET and FRIDGE_UNLOCK_API_KEY to enable',
  );
}
```

- [ ] **Step 4: Write the failing integration test**

Create `apps/api/test/fridge/unlock.route.test.ts`:

```ts
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
    expect(events[0].status).toBe('failed_offline');
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
    expect(events[0].status).toBe('sent');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- unlock.route`
Expected: FAIL — `app.fridge` / routes not wired yet (before Step 3 is complete) or route 404. If Step 3 is already done, it should pass.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- unlock.route`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck the whole API**

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/fridge-ws.ts apps/api/src/routes/fridge-unlock.ts apps/api/src/app.ts apps/api/test/fridge/unlock.route.test.ts
git commit -m "feat(api): add fridge ws + unlock routes"
```

---

### Task 7: Full verification + secrets doc

**Files:**

- Modify: `docs/secrets.md` (document the two new env vars)

- [ ] **Step 1: Run the full API test suite**

Run: `pnpm --filter @ccc/api test`
Expected: PASS, including the new fridge tests.

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @ccc/api lint`
Expected: PASS.

- [ ] **Step 3: Document the secrets**

In `docs/secrets.md`, add two rows in the API env inventory (match the existing format):

- `FRIDGE_DEVICE_SECRET` — shared secret the ESP32 presents on the WS connect and receives inside the `UNLOCK:<secret>` frame. Min 32 chars. Never sent to the frontend.
- `FRIDGE_UNLOCK_API_KEY` — service key required in the `X-API-Key` header on `POST /api/fridge/unlock`. Min 32 chars.

- [ ] **Step 4: Commit**

```bash
git add docs/secrets.md
git commit -m "docs: document fridge env secrets"
```

- [ ] **Step 5: Report firmware values to the user**

Report the concrete `WS_HOST`, `WS_PORT`, `WS_PATH`, `DEVICE_SECRET`, and message formats (see the Firmware Handoff section below).

---

## Firmware Handoff (report to user after implementation)

- `WS_HOST` = the API public host without scheme (e.g. `api-production.up.railway.app`, from `NEXT_PUBLIC_API_BASE_URL`). Confirm the exact host with the user.
- `WS_PORT` = `443` (WSS via the Railway edge).
- `WS_PATH` = `/ws/fridge`
- `DEVICE_SECRET` = the value set in Railway as `FRIDGE_DEVICE_SECRET` (generate a >=32 char random secret; never commit it).
- Connect URL: `wss://<WS_HOST>/ws/fridge?id=fridge-01&secret=<DEVICE_SECRET>`
- Server → device open command (text frame): `UNLOCK:<DEVICE_SECRET>` — firmware validates the suffix matches its secret before actuating the relay.
- Heartbeat: respond to WS protocol ping with pong (default in `arduinoWebsockets`/`ArduinoWebsockets`). No app-level heartbeat message needed.
- Reconnect: on disconnect, retry the connect URL with backoff. The server replaces the old registration automatically.

---

## Self-Review

- **Spec coverage:** `/ws/fridge` (Task 6), device identifies as `fridge-01` + auth (Tasks 5/6), active-connection registry + heartbeat/reconnect (Task 4), `POST /api/fridge/unlock` (Task 6), `UNLOCK:<DEVICE_SECRET>` over WS (Tasks 4/6), secret from env never to frontend (Tasks 1/6/7), request auth before command (Task 6), offline error (Task 6), connect/disconnect/unlock logs without secrets (Tasks 4/5/6), user-association prep via optional `userId` (Task 3). All covered.
- **Placeholders:** none — every code step has full content.
- **Type consistency:** `FridgeSocket`, `FridgeRegistry`, `createFridgeRegistry`, `handleFridgeConnection`, `FridgeConnectionSocket`, `safeEqual`, `FRIDGE_DEVICE_ID`, `fridgeUnlockBodySchema`, `prisma.fridgeUnlockEvent` used consistently across tasks.
