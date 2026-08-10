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
