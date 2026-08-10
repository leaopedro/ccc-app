# Fridge ESP32 WSS Integration — Design

**Date:** 2026-08-07
**Status:** Approved (brainstorming)

## Goal

Let the backend open a physical fridge lock driven by an ESP32. The ESP32 holds
a persistent secure WebSocket to the API. A service-authenticated HTTP endpoint
tells the API to push an unlock command to that device.

## Decisions

- Device authenticates the WS connection with `DEVICE_SECRET` at connect. One
  shared secret, reused inside the command.
- `POST /api/fridge/unlock` is protected by a service API key (`X-API-Key`),
  compared in constant time.
- Fire-and-forget: check the device is online, send the command, return `200`.
  Return `503` when offline. No ACK/timeout in this phase.
- Every attempt is persisted to `FridgeUnlockEvent` with an optional `userId`,
  preparing later association with a user profile.

## Infra invariants

- Railway runs `numReplicas: 1`. The active-connection registry lives in
  process memory. This design is only correct at a single replica. Scaling out
  requires shared state (out of scope now). Documented in the WS route.
- TLS terminates at the Railway edge. The app listens on `ws://` internally;
  the ESP32 connects to `wss://<api-host>/ws/fridge` on port `443`.

## Components

1. **Dependency:** `@fastify/websocket` `^11` (Fastify 5 compatible; wraps `ws`).
2. **Env** (`apps/api/src/env.ts`), both optional; feature registers only when
   both are set (mirrors the AbacatePay gate):
   - `FRIDGE_DEVICE_SECRET` — `z.string().min(32)`
   - `FRIDGE_UNLOCK_API_KEY` — `z.string().min(32)`
3. **`apps/api/src/services/fridge/registry.ts`** — in-memory registry of one
   live socket per `deviceId`. Tracks liveness, runs a 30s heartbeat ping,
   terminates a socket after 2 missed pongs, replaces the socket on reconnect.
   Exposes `register`, `markAlive`, `isOnline`, `sendUnlock`, `remove`,
   `stopHeartbeat`. Includes a constant-time string compare helper.
4. **`apps/api/src/routes/fridge-ws.ts`** — `GET /ws/fridge` (WS upgrade).
   Validates `id` and `secret` query params against `FRIDGE_DEVICE_SECRET` and
   the fixed device id. Rejects with close code `4401` on mismatch. Registers
   the socket, wires `pong`/`message`/`close`, logs connect/disconnect.
5. **`apps/api/src/routes/fridge-unlock.ts`** — `POST /api/fridge/unlock`.
   Validates `X-API-Key` (constant time). Parses an optional body
   `{ name?, email?, phone? }` (accepted, not persisted yet — LGPD needs a
   consent flow before storing walk-up PII). `503` if offline. Sends
   `UNLOCK:<secret>`, writes a `FridgeUnlockEvent`, returns `200`. Rate limited.
6. **DB** (`packages/db/prisma/schema.prisma`) — `FridgeUnlockEvent` with
   `enum FridgeUnlockStatus { sent, failed_offline }`, optional `userId` FK to
   `User` (`onDelete: SetNull`), `deviceId`, `createdAt`, indexes on
   `[deviceId, createdAt]` and `[userId]`.
7. **Shared** (`packages/shared/src/fridge.ts`) — Zod schemas for the unlock
   body/response and the `FRIDGE_DEVICE_ID = 'fridge-01'` constant.

## WebSocket message contract

- **Device connects:** `wss://<api-host>/ws/fridge?id=fridge-01&secret=<DEVICE_SECRET>`
- **Server → device (open):** text frame `UNLOCK:<DEVICE_SECRET>`
- **Heartbeat:** protocol-level WS ping/pong. Server pings every 30s; ESP32
  auto-pongs. Two missed pongs drop the connection.
- **Device → server:** any text frame (e.g. `OK`) is logged only. No ACK
  required this phase.
- **Reconnection:** handled by firmware. A new connection replaces the old
  socket in the registry.

## Security / logging

- `DEVICE_SECRET` and `FRIDGE_UNLOCK_API_KEY` never reach the frontend and are
  never logged. Logs carry only `deviceId`, optional `userId`, and `status`.
- WS connection is closed when the secret does not match.
- Unlock endpoint is rate limited (CLAUDE.md requirement).

## Testing

- Registry unit tests with a fake socket: register/replace, offline check,
  `sendUnlock` payload, liveness.
- Unlock route: `401` without/with wrong API key, `503` when offline, `200` +
  persisted `FridgeUnlockEvent` when a fake socket is registered.
- DB integration via the repo's Testcontainers Postgres harness.

## Out of scope (now)

- No UI, no walk-up user registration flow, no PII persistence.
- No ACK/timeout, no multi-device support beyond the generic `id` registry.
- No multi-replica / shared-state support.

## Firmware handoff values (reported after implementation)

`WS_HOST`, `WS_PORT` (`443`), `WS_PATH` (`/ws/fridge`), `DEVICE_SECRET`, and the
final message formats above.
