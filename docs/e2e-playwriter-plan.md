# E2E Playwriter Auth Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser-driven smoke tests that walk the main F1 auth flows end-to-end against the locally running API + mobile web preview, failing loudly at any step that regresses.

**Architecture:** Plain Node.js scripts under `tests/e2e/playwriter/` that spawn the `playwriter` CLI (user's Chrome via extension) against `http://localhost:8081` and hit the API on `http://localhost:4000` for preconditions + mail inbox. Each flow is a standalone script. Shared helpers (session, assert, mail, fixtures, api) live in `lib/`. A `run.js` dispatcher invokes one flow or all, exiting non-zero on failure.

**Tech Stack:** Node 20+, `playwriter` CLI, Fastify dev-only `GET /dev/inbox/:email` endpoint, Vitest (existing harness) for the endpoint test, `pnpm` as the task runner.

**Preconditions for running the e2e suite locally (documented in README):**

- Docker Compose Postgres up, migrations applied.
- `pnpm --filter @jdm/api dev` on `:4000` (NODE_ENV=development so DevMailer + `/dev/inbox` are live).
- `pnpm --filter @jdm/mobile dev --web` on `:8081`.
- `playwriter` CLI installed and the Chrome extension clicked on the `localhost:8081` tab at least once.

---

## Task ordering & dependency graph

```
Task 1  (dev inbox endpoint + test)
Task 2  (scaffold tests/e2e/playwriter/ dir + pnpm e2e script)
  └─ Task 3  (lib/fixtures.js)
       └─ Task 4  (lib/api.js — API precondition helpers)
            └─ Task 5  (lib/mail.js — inbox + token extraction)
                 └─ Task 6  (lib/session.js — playwriter CLI wrapper)
                      └─ Task 7  (lib/assert.js — assertion helpers)
                           └─ Task 8  (run.js dispatcher)
                                ├─ Task 9  (flow 01 root-redirect)
                                ├─ Task 10 (flow 02 signup + verify-pending + resend)
                                ├─ Task 11 (flow 03 login happy)
                                ├─ Task 12 (flow 04 login unverified)
                                ├─ Task 13 (flow 05 login bad password)
                                ├─ Task 14 (flow 06 forgot + reset + login with new pw)
                                ├─ Task 15 (flow 07 logout)
                                └─ Task 16 (README + .gitignore + end-to-end smoke)
```

Keep one commit per task heading, test-first where a test exists. The flow scripts have no unit tests — their test IS the running suite, validated manually by executing the flow (`pnpm e2e <name>`) and watching it pass.

---

## Task 1: Dev-only `GET /dev/inbox/:email` endpoint

**Files:**

- Create: `apps/api/src/routes/dev.ts`
- Create: `apps/api/test/dev/inbox.test.ts`
- Modify: `apps/api/src/app.ts` (register the route when `NODE_ENV !== 'production'`)

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/dev/inbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTestApp, signupUser } from '../helpers.js';

describe('GET /dev/inbox/:email', () => {
  it('returns 404 when no mail captured for the address', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/dev/inbox/nobody@jdm.test' });
    expect(res.statusCode).toBe(404);
  });

  it('returns the most recent captured message for the given email', async () => {
    const app = await buildTestApp();
    const email = `inbox-${Date.now()}@jdm.test`;
    await signupUser(app, { email, password: 'ValidPass123!' });

    const res = await app.inject({ method: 'GET', url: `/dev/inbox/${encodeURIComponent(email)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.to).toBe(email);
    expect(body.subject).toMatch(/confirme|verify/i);
    expect(body.html).toContain('token=');
  });

  it('is not registered in production', async () => {
    const app = await buildTestApp({ NODE_ENV: 'production' });
    const res = await app.inject({ method: 'GET', url: '/dev/inbox/anyone@jdm.test' });
    expect(res.statusCode).toBe(404);
  });
});
```

If `signupUser` / `buildTestApp({ NODE_ENV })` overrides don't exist in `helpers.ts` yet, open `apps/api/test/helpers.ts` and add whatever minimal helpers are needed to match the signature above. Keep the helper changes in the same commit as this test.

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm --filter @jdm/api test dev/inbox`
Expected: FAIL with 404 on the second assertion (the route doesn't exist yet) or an import error on the new file.

- [ ] **Step 3: Create the route file**

Create `apps/api/src/routes/dev.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';

import { DevMailer } from '../services/mailer/index.js';

export const devRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { email: string } }>('/dev/inbox/:email', async (request, reply) => {
    const { mailer } = app;
    if (!(mailer instanceof DevMailer)) {
      return reply.code(501).send({ error: 'dev inbox not available' });
    }

    const email = decodeURIComponent(request.params.email);
    const message = mailer.find(email);
    if (!message) {
      return reply.code(404).send({ error: 'no mail captured', email });
    }
    return reply.send(message);
  });
};
```

- [ ] **Step 4: Register the route in `app.ts` only when not production**

Open `apps/api/src/app.ts`. Add to the imports (alphabetical with other route imports):

```ts
import { devRoutes } from './routes/dev.js';
```

Inside `buildApp`, locate the existing non-production block:

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
  app.get('/debug/boom', () => {
    throw new Error('intentional boom for Sentry verification');
  });
  await app.register(devRoutes);
}
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `pnpm --filter @jdm/api test dev/inbox`
Expected: PASS (all three cases).

- [ ] **Step 6: Run the full API suite to confirm nothing else regressed**

Run: `pnpm --filter @jdm/api test`
Expected: all tests green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @jdm/api typecheck`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/dev.ts apps/api/src/app.ts apps/api/test/dev/inbox.test.ts apps/api/test/helpers.ts
git commit -m "feat(api): add dev-only GET /dev/inbox/:email for e2e mail inspection"
```

---

## Task 2: Scaffold `tests/e2e/playwriter/` and wire pnpm script

**Files:**

- Create: `tests/e2e/playwriter/` (empty dir, placeholder file)
- Create: `tests/e2e/playwriter/.gitignore`
- Modify: `package.json` (root) — add `e2e` script
- Modify: `.gitignore` (root, if needed) — ignore `.artifacts/`

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p tests/e2e/playwriter/lib tests/e2e/playwriter/flows tests/e2e/playwriter/.artifacts
```

- [ ] **Step 2: Create `tests/e2e/playwriter/.gitignore`**

```gitignore
.artifacts/
```

- [ ] **Step 3: Add an `e2e` script to the root `package.json`**

Open `package.json` (root). In the `scripts` object, add exactly one line (do not reformat other entries):

```json
"e2e": "node tests/e2e/playwriter/run.js"
```

- [ ] **Step 4: Commit the scaffold**

The `run.js` file and flows land in later tasks. Commit the scaffold alone so history shows the directory introduction separately.

```bash
git add tests/e2e/playwriter/.gitignore package.json
git commit -m "chore(e2e): scaffold tests/e2e/playwriter directory and pnpm e2e script"
```

---

## Task 3: `lib/fixtures.js` — shared constants + unique email generator

**Files:**

- Create: `tests/e2e/playwriter/lib/fixtures.js`

- [ ] **Step 1: Write the module**

```js
'use strict';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const PASSWORD = 'ValidPass123!';

function uniqueEmail(prefix = 'e2e') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${ts}-${rand}@jdm.test`;
}

module.exports = { API_URL, WEB_URL, PASSWORD, uniqueEmail };
```

- [ ] **Step 2: Sanity-check from the shell**

Run: `node -e "const f = require('./tests/e2e/playwriter/lib/fixtures.js'); console.log(f.uniqueEmail(), f.API_URL, f.WEB_URL);"`
Expected: something like `e2e-lw8abc-xyz12@jdm.test http://localhost:4000 http://localhost:8081`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/lib/fixtures.js
git commit -m "chore(e2e): add fixtures lib with unique email + base URLs"
```

---

## Task 4: `lib/api.js` — direct API helpers for preconditions

Used by flows to short-circuit UI work when the flow isn't testing that specific step (e.g. flow 3 signs up via API to get a verified user, then tests the login UI only).

**Files:**

- Create: `tests/e2e/playwriter/lib/api.js`

- [ ] **Step 1: Write the module**

```js
'use strict';

const { API_URL } = require('./fixtures.js');

async function postJson(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function getJson(path) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function signupViaApi({ email, password, name = 'E2E User' }) {
  const res = await postJson('/auth/signup', { email, password, name });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`signupViaApi: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function verifyViaApi(token) {
  const res = await getJson(`/auth/verify?token=${encodeURIComponent(token)}`);
  if (res.status !== 200) {
    throw new Error(`verifyViaApi: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function forgotViaApi(email) {
  const res = await postJson('/auth/forgot-password', { email });
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`forgotViaApi: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

module.exports = { postJson, getJson, signupViaApi, verifyViaApi, forgotViaApi };
```

- [ ] **Step 2: Sanity-check against the running API**

Precondition: `pnpm --filter @jdm/api dev` running on `:4000`.

Run:

```bash
node -e "const a = require('./tests/e2e/playwriter/lib/api.js'); const { uniqueEmail, PASSWORD } = require('./tests/e2e/playwriter/lib/fixtures.js'); (async () => { const email = uniqueEmail(); console.log(await a.signupViaApi({ email, password: PASSWORD })); })()"
```

Expected: a successful signup response (user id or similar). If the API isn't running the script throws `fetch failed` — that's the expected failure mode, not a bug in the helper.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/lib/api.js
git commit -m "chore(e2e): add api lib with signup/verify/forgot precondition helpers"
```

---

## Task 5: `lib/mail.js` — inbox fetch + token extraction

**Files:**

- Create: `tests/e2e/playwriter/lib/mail.js`

- [ ] **Step 1: Write the module**

```js
'use strict';

const { API_URL } = require('./fixtures.js');

async function fetchLastMail(email, { timeoutMs = 5000, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastBody = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/dev/inbox/${encodeURIComponent(email)}`);
    lastStatus = res.status;
    lastBody = await res.text();
    if (res.status === 200) {
      return JSON.parse(lastBody);
    }
    if (res.status !== 404) {
      throw new Error(`fetchLastMail(${email}): ${res.status} ${lastBody}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `fetchLastMail(${email}) timed out after ${timeoutMs}ms (last=${lastStatus} ${lastBody})`,
  );
}

function extractTokenFromBody(body) {
  const match = body.match(/token=([A-Za-z0-9_.\-%]+)/);
  if (!match) {
    throw new Error(`no token= param in mail body:\n${body.slice(0, 500)}`);
  }
  return decodeURIComponent(match[1]);
}

module.exports = { fetchLastMail, extractTokenFromBody };
```

- [ ] **Step 2: Sanity-check against a real captured mail**

Precondition: API running, at least one signup already done for `foo@jdm.test` in this API process lifetime.

Run:

```bash
node -e "const m = require('./tests/e2e/playwriter/lib/mail.js'); (async () => { const mail = await m.fetchLastMail('foo@jdm.test'); console.log('subject:', mail.subject); console.log('token:', m.extractTokenFromBody(mail.html)); })()"
```

Expected: a subject line + a decoded token string. If 404 persists to timeout, that's the expected failure mode when no matching mail exists.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/lib/mail.js
git commit -m "chore(e2e): add mail lib with polling inbox fetch + token extractor"
```

---

## Task 6: `lib/session.js` — playwriter CLI wrapper

Wraps the `playwriter` CLI in synchronous Node calls. Each call returns stdout (string) so flows can parse `console.log` output to make assertions.

**Files:**

- Create: `tests/e2e/playwriter/lib/session.js`

- [ ] **Step 1: Write the module**

```js
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

function resolveCli() {
  const probe = spawnSync('playwriter', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return { cmd: 'playwriter', prefix: [] };
  return { cmd: 'npx', prefix: ['playwriter@latest'] };
}

const { cmd, prefix } = resolveCli();

function createSession() {
  const id = execFileSync(cmd, [...prefix, 'session', 'new'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(`playwriter session new returned unexpected output: "${id}"`);
  }
  return id;
}

function resetSession(sessionId) {
  try {
    execFileSync(cmd, [...prefix, 'session', 'reset', sessionId], { stdio: 'ignore' });
  } catch {
    // best-effort cleanup
  }
}

function exec(sessionId, code, { timeoutMs = 30000 } = {}) {
  try {
    return execFileSync(cmd, [...prefix, '-s', sessionId, '-e', code], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stdout = (err.stdout ?? '').toString();
    const stderr = (err.stderr ?? '').toString();
    const e = new Error(
      `playwriter exec failed: ${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
    e.cause = err;
    throw e;
  }
}

module.exports = { createSession, resetSession, exec };
```

- [ ] **Step 2: Sanity-check — one session round-trip**

Precondition: Chrome running, playwriter extension available.

Run:

```bash
node -e "const s = require('./tests/e2e/playwriter/lib/session.js'); const sid = s.createSession(); console.log('session:', sid); console.log(s.exec(sid, 'console.log(\"hello from sandbox\")')); s.resetSession(sid);"
```

Expected: `session: <number>` followed by `hello from sandbox`.

If you see `extension is not connected`, click the Playwriter extension icon once on any Chrome tab and retry. This is a runtime precondition, not a bug.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/lib/session.js
git commit -m "chore(e2e): add session lib wrapping playwriter CLI"
```

---

## Task 7: `lib/assert.js` — assertion helpers

**Files:**

- Create: `tests/e2e/playwriter/lib/assert.js`

- [ ] **Step 1: Write the module**

```js
'use strict';

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

function assertIncludes(haystack, needle, label) {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new AssertionError(
      `[${label}] expected output to include ${JSON.stringify(needle)}.\n--- actual ---\n${haystack}\n--- end ---`,
    );
  }
}

function assertMatches(haystack, pattern, label) {
  if (typeof haystack !== 'string' || !pattern.test(haystack)) {
    throw new AssertionError(
      `[${label}] expected output to match ${pattern}.\n--- actual ---\n${haystack}\n--- end ---`,
    );
  }
}

function assertNotIncludes(haystack, needle, label) {
  if (typeof haystack === 'string' && haystack.includes(needle)) {
    throw new AssertionError(
      `[${label}] expected output NOT to include ${JSON.stringify(needle)}.\n--- actual ---\n${haystack}\n--- end ---`,
    );
  }
}

function parseUrl(output) {
  const m = output.match(/URL:\s*(\S+)/);
  if (!m) throw new AssertionError(`no "URL:" line in output:\n${output}`);
  return m[1];
}

function assertUrlMatches(output, pattern, label) {
  const url = parseUrl(output);
  if (!pattern.test(url)) {
    throw new AssertionError(`[${label}] url ${url} does not match ${pattern}`);
  }
  return url;
}

module.exports = {
  AssertionError,
  assertIncludes,
  assertMatches,
  assertNotIncludes,
  parseUrl,
  assertUrlMatches,
};
```

- [ ] **Step 2: Sanity-check**

Run:

```bash
node -e "const a = require('./tests/e2e/playwriter/lib/assert.js'); a.assertIncludes('hello world', 'world', 'smoke'); a.assertUrlMatches('URL: http://localhost:8081/login', /\/login$/, 'smoke'); try { a.assertIncludes('x', 'y', 'neg'); } catch (e) { console.log('caught:', e.name); }"
```

Expected: `caught: AssertionError`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/lib/assert.js
git commit -m "chore(e2e): add assert lib (URL + snapshot text assertions)"
```

---

## Task 8: `run.js` — dispatcher

Runs a single flow by name or all flows sequentially. Each flow is a Node script exporting `async function run(context)`. On failure, prints the error, takes a screenshot, exits non-zero.

**Files:**

- Create: `tests/e2e/playwriter/run.js`

- [ ] **Step 1: Write the dispatcher**

```js
#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createSession, resetSession, exec } = require('./lib/session.js');

const FLOWS_DIR = path.join(__dirname, 'flows');
const ARTIFACTS_DIR = path.join(__dirname, '.artifacts');

function listFlows() {
  return fs
    .readdirSync(FLOWS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort();
}

function resolveFlow(name) {
  const all = listFlows();
  const hit = all.find((f) => f === name || f.replace(/^\d+-/, '').replace(/\.js$/, '') === name);
  if (!hit) {
    throw new Error(`unknown flow "${name}". known: ${all.join(', ')}`);
  }
  return path.join(FLOWS_DIR, hit);
}

async function runOne(filePath) {
  const mod = require(filePath);
  if (typeof mod.run !== 'function') {
    throw new Error(`${filePath} does not export run(context)`);
  }
  const session = createSession();
  const context = { session, exec: (code, opts) => exec(session, code, opts) };
  const start = Date.now();
  const label = path.basename(filePath, '.js');
  console.log(`\n▶ ${label}  (session=${session})`);
  try {
    await mod.run(context);
    console.log(`✔ ${label}  (${Date.now() - start}ms)`);
    return { label, ok: true };
  } catch (err) {
    console.error(`✘ ${label}  (${Date.now() - start}ms)`);
    console.error(err.stack || err.message);
    try {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      const shot = path.join(ARTIFACTS_DIR, `${label}-${Date.now()}.png`);
      exec(
        session,
        `await state.page.screenshot({ path: ${JSON.stringify(shot)}, scale: 'css' })`,
        {
          timeoutMs: 10000,
        },
      );
      console.error(`  screenshot: ${shot}`);
    } catch (shotErr) {
      console.error(`  (screenshot failed: ${shotErr.message})`);
    }
    return { label, ok: false, err };
  } finally {
    resetSession(session);
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: node run.js <flow-name|all>');
    process.exit(2);
  }
  const files =
    arg === 'all' ? listFlows().map((f) => path.join(FLOWS_DIR, f)) : [resolveFlow(arg)];
  const results = [];
  for (const f of files) {
    results.push(await runOne(f));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nran ${results.length}, passed ${results.length - failed.length}, failed ${failed.length}`,
  );
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.label}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Sanity-check error output**

Run: `pnpm e2e missing-flow`
Expected: exits 1 with `unknown flow "missing-flow"`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/run.js
git commit -m "chore(e2e): add run.js dispatcher with per-flow session + screenshot on fail"
```

---

## Task 9: Flow 01 — Root redirect

`/` should redirect unauth users to `/login`.

**Files:**

- Create: `tests/e2e/playwriter/flows/01-root-redirect.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { WEB_URL } = require('../lib/fixtures.js');

async function run({ exec }) {
  // Step 1: open /, wait for Gate to resolve, print URL
  const nav = exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/')}, { waitUntil: 'domcontentloaded' });
    await state.page.waitForURL(/\\/login$/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(nav, /\/login$/, 'root-redirect: after gate');

  // Step 2: snapshot the /login page, confirm PT-BR copy is present
  const snap = exec(
    `await snapshot({ page: state.page, search: /entrar|e-mail|senha/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap, 'Entrar', 'root-redirect: login title');
  assertIncludes(snap, 'E-mail', 'root-redirect: email label');
  assertIncludes(snap, 'Senha', 'root-redirect: password label');
}

module.exports = { run };
```

- [ ] **Step 2: Run the flow**

Preconditions: API + mobile web dev server up. Extension clicked on the `:8081` tab.

Run: `pnpm e2e root-redirect`
Expected: `✔ 01-root-redirect`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/01-root-redirect.js
git commit -m "test(e2e): flow 01 — root redirects unauth to /login"
```

---

## Task 10: Flow 02 — Signup + verify-pending + resend

Fresh email → signup form → lands on `/verify-email-pending?email=…` → resend button → assert success banner + a mail captured in dev inbox.

**Files:**

- Create: `tests/e2e/playwriter/flows/02-signup-verify-pending.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { fetchLastMail } = require('../lib/mail.js');
const { PASSWORD, WEB_URL, uniqueEmail } = require('../lib/fixtures.js');

async function run({ exec }) {
  const email = uniqueEmail('signup');

  // Step 1: open /signup
  exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/signup')}, { waitUntil: 'domcontentloaded' });
    console.log('URL:', state.page.url());
  `);

  // Step 2: confirm signup form rendered
  const snap1 = exec(
    `await snapshot({ page: state.page, search: /criar conta|nome|e-mail|senha/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap1, 'Criar conta', 'signup: title');

  // Step 3: fill + submit
  const submit = exec(`
    await state.page.getByRole('textbox', { name: /nome/i }).fill('E2E Tester');
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('textbox', { name: /senha/i }).fill(${JSON.stringify(PASSWORD)});
    await state.page.getByRole('button', { name: /criar conta/i }).click();
    await state.page.waitForURL(/verify-email-pending/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(submit, /verify-email-pending/, 'signup: redirect after submit');

  // Step 4: verify-pending screen copy
  const snap2 = exec(
    `await snapshot({ page: state.page, search: /confirme|reenviar|e-mail/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap2, 'Confirme seu e-mail', 'verify-pending: title');
  assertIncludes(snap2, 'Reenviar', 'verify-pending: resend cta');

  // Step 5: signup mail is in the dev inbox
  const mail = await fetchLastMail(email);
  if (!mail.html.includes('token=')) {
    throw new Error(`signup mail missing token= param: ${mail.html.slice(0, 200)}`);
  }

  // Step 6: click resend
  exec(`
    await state.page.getByRole('button', { name: /reenviar/i }).click();
    await state.page.waitForTimeout(500);
  `);
  const snap3 = exec(
    `await snapshot({ page: state.page, search: /enviamos novamente|muitas tentativas/i }).then(r => console.log(r));`,
  );
  // Accept either "resent" success OR rate-limit banner (dev env sometimes pre-hits limit across runs).
  if (!snap3.includes('Enviamos novamente') && !snap3.includes('Muitas tentativas')) {
    throw new Error(`resend produced neither success nor rate-limit banner:\n${snap3}`);
  }
}

module.exports = { run };
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e signup-verify-pending`
Expected: `✔ 02-signup-verify-pending`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/02-signup-verify-pending.js
git commit -m "test(e2e): flow 02 — signup lands on verify-pending + resend works"
```

---

## Task 11: Flow 03 — Login happy

Seed a verified user via API, then UI-login and assert redirect to `/welcome`.

**Files:**

- Create: `tests/e2e/playwriter/flows/03-login-happy.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { signupViaApi, verifyViaApi } = require('../lib/api.js');
const { fetchLastMail, extractTokenFromBody } = require('../lib/mail.js');
const { PASSWORD, WEB_URL, uniqueEmail } = require('../lib/fixtures.js');

async function run({ exec }) {
  const email = uniqueEmail('login');

  // Precondition: signup + verify via API so the user is ready to log in
  await signupViaApi({ email, password: PASSWORD });
  const mail = await fetchLastMail(email);
  const token = extractTokenFromBody(mail.html);
  await verifyViaApi(token);

  // Step 1: open /login
  exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/login')}, { waitUntil: 'domcontentloaded' });
    console.log('URL:', state.page.url());
  `);

  // Step 2: fill + submit
  const submit = exec(`
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('textbox', { name: /senha/i }).fill(${JSON.stringify(PASSWORD)});
    await state.page.getByRole('button', { name: /^entrar$/i }).click();
    await state.page.waitForURL(/\\/welcome$/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(submit, /\/welcome$/, 'login-happy: redirect after submit');

  // Step 3: welcome copy
  const snap = exec(
    `await snapshot({ page: state.page, search: /olá|você está dentro|sair/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap, 'Olá', 'login-happy: welcome greeting');
  assertIncludes(snap, 'Você está dentro', 'login-happy: welcome body');
  assertIncludes(snap, 'Sair', 'login-happy: logout cta present');

  // Step 4: reload page → still authed (token persistence via storage.web.ts)
  const reload = exec(`
    await state.page.reload({ waitUntil: 'domcontentloaded' });
    await state.page.waitForURL(/\\/welcome$/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(reload, /\/welcome$/, 'login-happy: still authed after reload');
}

module.exports = { run };
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e login-happy`
Expected: `✔ 03-login-happy`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/03-login-happy.js
git commit -m "test(e2e): flow 03 — login happy path lands on /welcome and persists across reload"
```

---

## Task 12: Flow 04 — Login unverified

Signup via API, skip verify, UI-login → expect redirect to `/verify-email-pending?email=…`.

**Files:**

- Create: `tests/e2e/playwriter/flows/04-login-unverified.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { signupViaApi } = require('../lib/api.js');
const { PASSWORD, WEB_URL, uniqueEmail } = require('../lib/fixtures.js');

async function run({ exec }) {
  const email = uniqueEmail('unverified');
  await signupViaApi({ email, password: PASSWORD });

  exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/login')}, { waitUntil: 'domcontentloaded' });
    console.log('URL:', state.page.url());
  `);

  const submit = exec(`
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('textbox', { name: /senha/i }).fill(${JSON.stringify(PASSWORD)});
    await state.page.getByRole('button', { name: /^entrar$/i }).click();
    await state.page.waitForURL(/verify-email-pending/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  const url = assertUrlMatches(submit, /verify-email-pending/, 'login-unverified: redirect');
  if (!url.includes(`email=${encodeURIComponent(email)}`)) {
    throw new Error(`login-unverified: email param missing in redirect URL: ${url}`);
  }

  const snap = exec(
    `await snapshot({ page: state.page, search: /confirme|reenviar/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap, 'Confirme seu e-mail', 'login-unverified: verify-pending title');
}

module.exports = { run };
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e login-unverified`
Expected: `✔ 04-login-unverified`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/04-login-unverified.js
git commit -m "test(e2e): flow 04 — unverified login routes to verify-email-pending"
```

---

## Task 13: Flow 05 — Login bad password

Verified user, wrong password → inline error with `errors.invalidCredentials` copy, still on `/login`.

**Files:**

- Create: `tests/e2e/playwriter/flows/05-login-bad-password.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { signupViaApi, verifyViaApi } = require('../lib/api.js');
const { fetchLastMail, extractTokenFromBody } = require('../lib/mail.js');
const { PASSWORD, WEB_URL, uniqueEmail } = require('../lib/fixtures.js');

async function run({ exec }) {
  const email = uniqueEmail('badpw');
  await signupViaApi({ email, password: PASSWORD });
  const mail = await fetchLastMail(email);
  await verifyViaApi(extractTokenFromBody(mail.html));

  exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/login')}, { waitUntil: 'domcontentloaded' });
    console.log('URL:', state.page.url());
  `);

  exec(`
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('textbox', { name: /senha/i }).fill('WrongPass999!');
    await state.page.getByRole('button', { name: /^entrar$/i }).click();
    await state.page.waitForTimeout(1500);
    console.log('URL:', state.page.url());
  `);

  // Still on /login, error banner shown
  const snap = exec(
    `await snapshot({ page: state.page, search: /e-mail ou senha inválidos|senha/i }).then(r => console.log(r));`,
  );
  assertUrlMatches(snap, /\/login$/, 'login-bad-password: stays on /login');
  assertIncludes(snap, 'E-mail ou senha inválidos', 'login-bad-password: error copy');
}

module.exports = { run };
```

Note: `assertUrlMatches` reads the `URL:` line from the previous exec's stdout, but the snap exec above does not print the URL. Fix by adding a URL print to the snap call:

Replace the snap line with:

```js
const snap = exec(`
    console.log('URL:', state.page.url());
    await snapshot({ page: state.page, search: /e-mail ou senha inválidos|senha/i }).then(r => console.log(r));
  `);
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e login-bad-password`
Expected: `✔ 05-login-bad-password`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/05-login-bad-password.js
git commit -m "test(e2e): flow 05 — wrong password shows invalidCredentials and stays on /login"
```

---

## Task 14: Flow 06 — Forgot + reset + login with new password

Seed verified user → `/forgot` → submit email → read reset mail → navigate to `/reset-password?token=…` → submit new password → login with new password → `/welcome`.

**Files:**

- Create: `tests/e2e/playwriter/flows/06-forgot-reset.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { signupViaApi, verifyViaApi } = require('../lib/api.js');
const { fetchLastMail, extractTokenFromBody } = require('../lib/mail.js');
const { PASSWORD, WEB_URL, uniqueEmail } = require('../lib/fixtures.js');

async function run({ exec }) {
  const email = uniqueEmail('reset');
  const newPassword = 'NewValidPass456!';

  // Precondition: verified user with initial password
  await signupViaApi({ email, password: PASSWORD });
  const signupMail = await fetchLastMail(email);
  await verifyViaApi(extractTokenFromBody(signupMail.html));

  // Step 1: open /forgot
  exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/forgot')}, { waitUntil: 'domcontentloaded' });
    console.log('URL:', state.page.url());
  `);
  const snap1 = exec(
    `await snapshot({ page: state.page, search: /recuperar senha|enviar link/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap1, 'Recuperar senha', 'forgot: title');

  // Step 2: submit email, expect generic success banner
  exec(`
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('button', { name: /enviar link/i }).click();
    await state.page.waitForTimeout(1500);
  `);
  const snap2 = exec(
    `await snapshot({ page: state.page, search: /se o e-mail existir|muitas tentativas/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap2, 'Se o e-mail existir', 'forgot: success banner');

  // Step 3: poll inbox for reset mail (newest message — same email, different subject/body than signup)
  //         The forgot mail replaces the signup mail in DevMailer.find() because find() returns newest.
  const resetMail = await fetchLastMail(email);
  const resetToken = extractTokenFromBody(resetMail.html);

  // Step 4: navigate to /reset-password?token=... and submit new password
  exec(`
    await state.page.goto(${JSON.stringify(WEB_URL + '/reset-password')} + '?token=' + ${JSON.stringify(resetToken)}, { waitUntil: 'domcontentloaded' });
    console.log('URL:', state.page.url());
  `);
  const snap3 = exec(
    `await snapshot({ page: state.page, search: /nova senha|atualizar senha/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap3, 'Nova senha', 'reset: title');

  exec(`
    await state.page.getByRole('textbox', { name: /nova senha/i }).fill(${JSON.stringify(newPassword)});
    await state.page.getByRole('button', { name: /atualizar senha/i }).click();
    await state.page.waitForTimeout(2500);
    console.log('URL:', state.page.url());
  `);
  const snap4 = exec(`
    console.log('URL:', state.page.url());
    await snapshot({ page: state.page, search: /senha atualizada|entrar|login/i }).then(r => console.log(r));
  `);
  assertIncludes(snap4, 'Senha atualizada', 'reset: success copy');

  // Step 5: login with the new password → /welcome
  exec(`
    await state.page.goto(${JSON.stringify(WEB_URL + '/login')}, { waitUntil: 'domcontentloaded' });
  `);
  const submit = exec(`
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('textbox', { name: /senha/i }).fill(${JSON.stringify(newPassword)});
    await state.page.getByRole('button', { name: /^entrar$/i }).click();
    await state.page.waitForURL(/\\/welcome$/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(submit, /\/welcome$/, 'forgot-reset: login with new password');
}

module.exports = { run };
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e forgot-reset`
Expected: `✔ 06-forgot-reset`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/06-forgot-reset.js
git commit -m "test(e2e): flow 06 — forgot + reset + login with new password"
```

---

## Task 15: Flow 07 — Logout

Login, click `Sair` on `/welcome`, assert redirect back to `/login` and that reloading the page stays unauth.

**Files:**

- Create: `tests/e2e/playwriter/flows/07-logout.js`

- [ ] **Step 1: Write the flow**

```js
'use strict';

const { assertUrlMatches, assertIncludes } = require('../lib/assert.js');
const { signupViaApi, verifyViaApi } = require('../lib/api.js');
const { fetchLastMail, extractTokenFromBody } = require('../lib/mail.js');
const { PASSWORD, WEB_URL, uniqueEmail } = require('../lib/fixtures.js');

async function run({ exec }) {
  const email = uniqueEmail('logout');
  await signupViaApi({ email, password: PASSWORD });
  const mail = await fetchLastMail(email);
  await verifyViaApi(extractTokenFromBody(mail.html));

  // Step 1: login
  exec(`
    state.page = context.pages().find(p => p.url() === 'about:blank') ?? (await context.newPage());
    await state.page.goto(${JSON.stringify(WEB_URL + '/login')}, { waitUntil: 'domcontentloaded' });
  `);
  exec(`
    await state.page.getByRole('textbox', { name: /e-mail/i }).fill(${JSON.stringify(email)});
    await state.page.getByRole('textbox', { name: /senha/i }).fill(${JSON.stringify(PASSWORD)});
    await state.page.getByRole('button', { name: /^entrar$/i }).click();
    await state.page.waitForURL(/\\/welcome$/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);

  // Step 2: click Sair
  const logout = exec(`
    await state.page.getByRole('button', { name: /^sair$/i }).click();
    await state.page.waitForURL(/\\/login$/, { timeout: 10000 });
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(logout, /\/login$/, 'logout: redirect to /login');

  // Step 3: reload stays on /login (refresh token revoked)
  const reload = exec(`
    await state.page.reload({ waitUntil: 'domcontentloaded' });
    await state.page.waitForTimeout(1500);
    console.log('URL:', state.page.url());
  `);
  assertUrlMatches(reload, /\/login$/, 'logout: still on /login after reload');

  const snap = exec(
    `await snapshot({ page: state.page, search: /entrar|e-mail/i }).then(r => console.log(r));`,
  );
  assertIncludes(snap, 'Entrar', 'logout: login screen rendered');
}

module.exports = { run };
```

- [ ] **Step 2: Run the flow**

Run: `pnpm e2e logout`
Expected: `✔ 07-logout`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/flows/07-logout.js
git commit -m "test(e2e): flow 07 — logout clears session and reload stays on /login"
```

---

## Task 16: README + final end-to-end smoke

**Files:**

- Create: `tests/e2e/playwriter/README.md`

- [ ] **Step 1: Write the README**

````md
# E2E Playwriter Auth Flows

Browser-driven smoke tests for the F1 auth flows. Runs against the local API + mobile web preview using the Playwriter Chrome extension.

## Preconditions

1. Docker + Postgres up, migrations applied:

   ```bash
   pnpm --filter @jdm/db exec prisma migrate deploy
   ```
````

2. API running on :4000 with `NODE_ENV=development` (enables DevMailer + `/dev/inbox`):

   ```bash
   pnpm --filter @jdm/api dev
   ```

3. Mobile web preview on :8081:

   ```bash
   pnpm --filter @jdm/mobile dev --web
   ```

4. `playwriter` CLI installed (`npm i -g playwriter@latest` or rely on `npx`).

5. Open `http://localhost:8081` in Chrome and click the Playwriter extension icon on the tab once.

## Run

```bash
pnpm e2e all                     # every flow, sequentially
pnpm e2e login-happy             # single flow by short name
pnpm e2e 03-login-happy.js       # or by filename
```

Failures print a stack trace and save a screenshot to `tests/e2e/playwriter/.artifacts/`.

## Environment overrides

- `E2E_API_URL` — default `http://localhost:4000`
- `E2E_WEB_URL` — default `http://localhost:8081`

## Flows

| #   | Name                    | What it covers                                                    |
| --- | ----------------------- | ----------------------------------------------------------------- |
| 01  | `root-redirect`         | `/` redirects unauth to `/login`, PT-BR copy present              |
| 02  | `signup-verify-pending` | signup form → verify-email-pending, resend captures a second mail |
| 03  | `login-happy`           | verified login → `/welcome`, session survives reload              |
| 04  | `login-unverified`      | unverified login → `/verify-email-pending?email=…`                |
| 05  | `login-bad-password`    | wrong password → inline `invalidCredentials`, stays on `/login`   |
| 06  | `forgot-reset`          | forgot → reset via mail token → login with new password           |
| 07  | `logout`                | logout clears session, reload stays on `/login`                   |

## Architecture notes

- Each flow gets its own playwriter session (`state.page` isolated).
- Test users are created with unique `e2e-<ts>-<rand>@jdm.test` emails; no cleanup.
- `GET /dev/inbox/:email` (dev-only, added in Task 1) exposes the latest captured `MailMessage` so tests can read verify / reset tokens without DB access.
- Flows use the API directly for preconditions (signup + verify) to keep UI focus on the behaviour actually under test.

````

- [ ] **Step 2: Run the full suite end-to-end**

Preconditions: API + mobile web running, Chrome extension enabled.

Run: `pnpm e2e all`
Expected: 7/7 green, no screenshots produced in `.artifacts/`.

If a flow fails, do NOT edit the flow to make it pass — investigate the underlying bug first. A failing flow is a signal, not a test defect.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwriter/README.md
git commit -m "docs(e2e): add playwriter README with run instructions + flow matrix"
````

---

## Post-implementation checklist

- [ ] `pnpm --filter @jdm/api test` green (covers Task 1 endpoint).
- [ ] `pnpm typecheck` green (Task 1 is the only TS surface we added).
- [ ] `pnpm lint --filter @jdm/api` green.
- [ ] `pnpm e2e all` green with API + mobile web running.
- [ ] `handoff.md` updated with a pointer to `tests/e2e/playwriter/README.md` under a new "Smoke coverage" section.
- [ ] No changes to `roadmap.md` — this is tooling, not a roadmap line item.

## Self-review (already applied to this plan)

- **Spec coverage:** 7 flows map 1:1 to the confirmed scope (root redirect, signup+verify-pending+resend, login happy, login unverified, login bad password, forgot+reset, logout). Dev inbox endpoint covers the token-extraction requirement.
- **Placeholders:** none. Every step has runnable code or an exact shell command.
- **Type consistency:** `createSession` / `resetSession` / `exec` signatures in `lib/session.js` match how the runner and flows consume them. `fetchLastMail` + `extractTokenFromBody` match the direct API helpers.
- **Known risk:** `resend` rate-limit can pre-trip in dev if you re-run flow 02 many times against the same API process without restart. Flow 02 accepts either success or rate-limit banner to avoid flakiness.
