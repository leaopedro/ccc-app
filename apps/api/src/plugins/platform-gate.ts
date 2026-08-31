import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import {
  resolveClientPlatform,
  subscriptionsEnabledFor,
  type ClientPlatform,
} from '../services/platform-gate/resolve.js';

declare module 'fastify' {
  interface FastifyRequest {
    clientPlatform: ClientPlatform;
    subscriptionsEnabled: boolean;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('clientPlatform', null as unknown as ClientPlatform);
  app.decorateRequest('subscriptionsEnabled', null as unknown as boolean);

  app.addHook('onRequest', async (request) => {
    const platformHeader = request.headers['x-ccc-platform'];
    const userAgentHeader = request.headers['user-agent'];
    const platform = resolveClientPlatform({
      ...(typeof platformHeader === 'string' ? { platform: platformHeader } : {}),
      ...(userAgentHeader !== undefined ? { userAgent: userAgentHeader } : {}),
    });
    request.clientPlatform = platform;
    request.subscriptionsEnabled = subscriptionsEnabledFor(platform, {
      ios: app.env.PREMIUM_SUBSCRIPTIONS_IOS,
      android: app.env.PREMIUM_SUBSCRIPTIONS_ANDROID,
      web: app.env.PREMIUM_SUBSCRIPTIONS_WEB,
    });
  });
};

export const platformGatePlugin = fp(plugin, { name: 'platform-gate' });
