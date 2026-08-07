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
