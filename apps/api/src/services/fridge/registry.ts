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
