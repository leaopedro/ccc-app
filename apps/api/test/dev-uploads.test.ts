import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp } from './helpers.js';

describe('dev upload server', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('stores a PUT and retrieves it via GET', async () => {
    const body = Buffer.from('fake-image-bytes');
    const objectKey = 'avatar/user123/test.jpg';

    const put = await app.inject({
      method: 'PUT',
      url: `/dev-uploads/put/${objectKey}`,
      headers: { 'content-type': 'image/jpeg' },
      body,
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/dev-uploads/${objectKey}`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toMatch(/image\/jpeg/);
    expect(get.rawPayload).toEqual(body);
  });

  it('returns 404 for a missing key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dev-uploads/avatar/nobody/nonexistent.jpg',
    });
    expect(res.statusCode).toBe(404);
  });

  it('accepts png and webp content types', async () => {
    for (const [ext, mime] of [
      ['png', 'image/png'],
      ['webp', 'image/webp'],
    ] as const) {
      const key = `car_photo/user123/test.${ext}`;
      const put = await app.inject({
        method: 'PUT',
        url: `/dev-uploads/put/${key}`,
        headers: { 'content-type': mime },
        body: Buffer.from(`fake-${ext}`),
      });
      expect(put.statusCode).toBe(200);

      const get = await app.inject({ method: 'GET', url: `/dev-uploads/${key}` });
      expect(get.statusCode).toBe(200);
      expect(get.headers['content-type']).toMatch(mime);
    }
  });
});
