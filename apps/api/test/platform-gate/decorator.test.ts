import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp } from '../helpers.js';

describe('platform gate decorator', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    app = await makeApp();
  });

  afterEach(async () => {
    delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
    await app.close();
  });

  it('decorates the request with the resolved platform', async () => {
    app.get('/__probe', async (request) => ({
      platform: request.clientPlatform,
      enabled: request.subscriptionsEnabled,
    }));
    await app.ready();

    const ios = await app.inject({
      method: 'GET',
      url: '/__probe',
      headers: { 'x-ccc-platform': 'ios' },
    });
    expect(ios.json()).toEqual({ platform: 'ios', enabled: false });

    const web = await app.inject({
      method: 'GET',
      url: '/__probe',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(web.json()).toEqual({ platform: 'web', enabled: true });
  });
});
