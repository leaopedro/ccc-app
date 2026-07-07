# Dev Upload File Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make avatar and car photo uploads work end-to-end in local development, while R2-backed staging/production uploads already work via the existing `R2Uploads` — no extra work needed there.

**Architecture:** `buildUploads(env)` already auto-selects the right backend: `R2Uploads` when all R2 env vars are present (staging/prod), `DevUploads` otherwise (local). `DevUploads` generates presigned PUT URLs at `http://localhost:4000/dev-uploads/put/{objectKey}` and public URLs at `http://localhost:4000/dev-uploads/{objectKey}` — the API just needs to handle them. Two dev-only routes: `PUT /dev-uploads/put/*` stores the raw binary body to OS tmpdir; `GET /dev-uploads/*` serves it back. Gated on `app.uploads instanceof DevUploads` (not just `NODE_ENV`) so staging with R2 keys configured never registers the dev routes. No mobile changes needed.

**Tech Stack:** Node.js built-ins (`node:fs`, `node:fs/promises`, `node:os`, `node:path`), Fastify wildcard routes, Fastify content-type parsers for binary bodies.

---

## File Structure

- **Create:** `apps/api/src/routes/dev-uploads.ts` — Fastify plugin with PUT (store to tmpdir) + GET (serve from tmpdir)
- **Modify:** `apps/api/src/app.ts` — register `devUploadRoutes` inside non-production block, gated on `instanceof DevUploads`
- **Create:** `apps/api/test/dev-uploads.test.ts` — integration tests: store a buffer, retrieve it, 404 for missing

---

## Task 1: Dev file server route + integration test

**Files:**

- Create: `apps/api/src/routes/dev-uploads.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/dev-uploads.test.ts`

- [x] **Step 1: Write the failing tests**

Create `apps/api/test/dev-uploads.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

describe('dev upload server', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
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
```

- [x] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter api test test/dev-uploads.test.ts`

Expected: `FAIL` — routes don't exist yet, PUT and GET return 404.

- [x] **Step 3: Create the dev upload plugin**

Create `apps/api/src/routes/dev-uploads.ts`:

```ts
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';

import type { FastifyPluginAsync } from 'fastify';

const UPLOAD_DIR = join(tmpdir(), 'jdm-dev-uploads');

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// eslint-disable-next-line @typescript-eslint/require-await
export const devUploadRoutes: FastifyPluginAsync = async (app) => {
  // Fastify only parses application/json by default; image bodies need explicit parsers.
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.put('/dev-uploads/put/*', async (request, reply) => {
    const objectKey = (request.params as { '*': string })['*'];
    const dest = join(UPLOAD_DIR, objectKey);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, request.body as Buffer);
    return reply.status(200).send();
  });

  app.get('/dev-uploads/*', async (request, reply) => {
    const objectKey = (request.params as { '*': string })['*'];
    const filePath = join(UPLOAD_DIR, objectKey);
    const ext = extname(filePath).slice(1).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    try {
      return reply.header('content-type', mime).send(createReadStream(filePath));
    } catch {
      return reply.status(404).send({ error: 'NotFound' });
    }
  });
};
```

- [x] **Step 4: Register in app.ts**

In `apps/api/src/app.ts`, add two imports after the existing route/service imports:

```ts
import { devUploadRoutes } from './routes/dev-uploads.js';
import { DevUploads } from './services/uploads/index.js';
```

Then find the existing non-production block at the bottom of `buildApp`:

```ts
if (env.NODE_ENV !== 'production') {
  app.get('/debug/boom', () => {
    throw new Error('intentional boom for Sentry verification');
  });
}
```

Replace it with:

```ts
if (env.NODE_ENV !== 'production') {
  // Register dev file server only when DevUploads is active.
  // Staging with R2 keys present uses R2Uploads and skips this.
  if (app.uploads instanceof DevUploads) {
    await app.register(devUploadRoutes);
  }
  app.get('/debug/boom', () => {
    throw new Error('intentional boom for Sentry verification');
  });
}
```

- [x] **Step 5: Run the new tests**

Run: `pnpm --filter api test test/dev-uploads.test.ts`

Expected output:

```
✓ test/dev-uploads.test.ts (3 tests)
  ✓ stores a PUT and retrieves it via GET
  ✓ returns 404 for a missing key
  ✓ accepts png and webp content types
```

- [x] **Step 6: Run the full test suite**

Run: `pnpm --filter api test`

Expected: all tests pass (no regressions from the content-type parser addition).

- [x] **Step 7: Typecheck**

Run: `pnpm -r typecheck`

Expected: no errors.

- [-] **Step 8: Verify end-to-end in the browser**

With `pnpm dev` running (no R2 env vars set locally):

1. Navigate to `localhost:8081/profile`
2. Tap "Alterar foto" and pick an image
3. Network tab: PUT to `localhost:4000/dev-uploads/put/avatar/...` → 200
4. Profile re-renders with avatar visible (image loaded from `localhost:4000/dev-uploads/avatar/...`)
5. Navigate to a car detail screen, add a car photo — same flow, different `objectKey` prefix (`car_photo/`)

- [x] **Step 9: Commit**

```bash
git add apps/api/src/routes/dev-uploads.ts apps/api/src/app.ts apps/api/test/dev-uploads.test.ts
git commit -m "feat(api): dev file server for local upload testing"
```
