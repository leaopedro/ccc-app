# Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the JDM Experience monorepo from empty to "anyone clones, runs `pnpm i && pnpm dev`, hits `/health` on the API, loads the Expo app on a simulator, and opens the admin page — with CI green and the three apps deployed to Railway/Vercel/EAS."

**Architecture:** Single pnpm workspace orchestrated by Turborepo. Three apps (`apps/api`, `apps/mobile`, `apps/admin`) consume three shared packages (`packages/tsconfig`, `packages/shared`, `packages/db`). API is Fastify + Prisma on Postgres; mobile is Expo (managed) + Expo Router; admin is Next.js 15 App Router + Tailwind. CI (GitHub Actions) runs lint + typecheck + test across all workspaces. Deploy targets: Railway (API + Postgres), Vercel (admin), EAS (mobile).

**Tech Stack:**

- Node 22 LTS, pnpm 10, Turborepo 2, TypeScript 5.7 (strict)
- Fastify 5, Pino, Prisma 6, Postgres 16
- Expo SDK 52, React Native 0.76, Expo Router 4
- Next.js 15, React 19, Tailwind 3.4
- Vitest 3 + Testcontainers (@testcontainers/postgresql) for API tests
- ESLint 9 (flat config), Prettier 3.3
- Zod 3.23 for shared schemas
- Sentry SDKs (`@sentry/node`, `@sentry/nextjs`, `@sentry/react-native` via Expo plugin)

**Repo conventions this plan locks in:**

- Workspace names: `@jdm/api`, `@jdm/mobile`, `@jdm/admin`, `@jdm/shared`, `@jdm/db`, `@jdm/tsconfig`.
- Env prefixes: API envs are unprefixed (`DATABASE_URL`, `JWT_SECRET`), mobile public envs use `EXPO_PUBLIC_*`, admin public envs use `NEXT_PUBLIC_*`.
- Commit style: Conventional Commits (`feat:`, `chore:`, `docs:`, `test:`, `ci:`).
- Strict TS everywhere: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

**Out of scope for Phase 0:** Any feature work (auth, events, tickets, push). This phase only proves the pipes work.

**Scaffolder usage:**

- **Use scaffolders** in Task 5 (`prisma init`), Task 8 (`create-expo-app`), Task 9 (`eas init` + `eas build:configure`), Task 10 (`create-next-app`), Task 15 (`@sentry/wizard` for Next + Expo).
- **Skip scaffolders** in Task 1 (`create-turbo` ships Next.js example apps + differently-named config packages that would need stripping/renaming — net negative) and Task 6 (`fastify-cli generate` imposes a plugin/autoload convention we don't want).
- In every scaffolder task, run the scaffolder first, then patch specific files to match this plan's target state. Diff `git status` after each patch step to confirm only the intended files changed.

---

## Task ordering & dependency chain

```
Task 1  (workspace scaffold)
  └─ Task 2  (tsconfig package)
       ├─ Task 3  (lint/format)
       ├─ Task 4  (packages/shared)
       ├─ Task 5  (packages/db)
       │    └─ Task 6  (apps/api)
       │         └─ Task 7  (api integration tests)
       ├─ Task 8  (apps/mobile)
       │    └─ Task 9  (EAS config)
       └─ Task 10 (apps/admin)
            └─ Task 11 (CI)
                 ├─ Task 12 (Railway deploy)
                 ├─ Task 13 (Vercel deploy)
                 ├─ Task 14 (secrets docs)
                 └─ Task 15 (Sentry wiring)
                      └─ Task 16 (README/CONTRIBUTING)
```

Each task ends with a Conventional Commit. Keep commits small — do not batch tasks into one commit.

---

## Task 1: Monorepo scaffold (roadmap 0.1)

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.npmrc`
- Create: `.nvmrc`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `apps/.gitkeep`
- Create: `packages/.gitkeep`

- [ ] **Step 1: Create `.nvmrc`**

```
22
```

- [ ] **Step 2: Create `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/
.next/
.expo/
.turbo/
*.tsbuildinfo

# Prisma
packages/db/prisma/migrations/dev.db*

# Env
.env
.env.*
!.env.example

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json.example
.idea/

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test artifacts
coverage/
.vitest/

# iOS / Android local builds
apps/mobile/ios/
apps/mobile/android/
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 4b: Create `.npmrc`** (Expo/Metro needs hoisted node_modules)

```
node-linker=hoisted
store-dir=~/.pnpm-store
strict-peer-dependencies=false
```

- [ ] **Step 5: Create root `package.json`**

```json
{
  "name": "jdm-experience",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@10.4.1",
  "engines": {
    "node": ">=22",
    "pnpm": ">=10.4.1"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,json,md}\""
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.2",
    "prettier": "^3.3.3"
  }
}
```

- [ ] **Step 6: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".nvmrc", "tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": ["**/*.tsbuildinfo"]
    },
    "test": {
      "outputs": ["coverage/**"]
    }
  }
}
```

Note: `.env` is intentionally not in `globalDependencies` — it's gitignored and per-developer. Per-variable cache busting lands as `globalEnv` entries in later tasks as real env vars emerge. `lint`/`test` don't depend on `^build` because workspace packages expose source (`main: "./src/index.ts"`), not compiled output.

- [ ] **Step 7: Create placeholder directories**

```bash
mkdir -p apps packages && touch apps/.gitkeep packages/.gitkeep
```

- [ ] **Step 8: Verify install + empty turbo run succeed**

Run:

```bash
corepack enable && corepack prepare pnpm@10.4.1 --activate
pnpm install
pnpm turbo run build
```

Expected: install creates `pnpm-lock.yaml`; `turbo run build` prints "No tasks were executed" (no workspaces with a `build` script yet) and exits 0.

- [ ] **Step 9: Commit**

```bash
git add .nvmrc .editorconfig .gitignore .npmrc pnpm-workspace.yaml package.json turbo.json pnpm-lock.yaml apps/.gitkeep packages/.gitkeep
git commit -m "chore: initialize pnpm + turborepo workspace"
```

---

## Task 2: Shared TypeScript config package (roadmap 0.2)

**Files:**

- Create: `packages/tsconfig/package.json`
- Create: `packages/tsconfig/base.json`
- Create: `packages/tsconfig/node.json`
- Create: `packages/tsconfig/react-native.json`
- Create: `packages/tsconfig/nextjs.json`

- [ ] **Step 1: Create `packages/tsconfig/package.json`**

```json
{
  "name": "@jdm/tsconfig",
  "version": "0.0.0",
  "private": true,
  "files": ["base.json", "node.json", "react-native.json", "nextjs.json"]
}
```

- [ ] **Step 2: Create `packages/tsconfig/base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}
```

- [ ] **Step 3: Create `packages/tsconfig/node.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"]
  }
}
```

- [ ] **Step 4: Create `packages/tsconfig/react-native.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "react-native",
    "lib": ["ES2022", "DOM"],
    "moduleResolution": "Bundler",
    "allowJs": true,
    "types": []
  }
}
```

- [ ] **Step 5: Create `packages/tsconfig/nextjs.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }]
  }
}
```

- [ ] **Step 6: Add `@jdm/tsconfig` to workspace install**

Run:

```bash
pnpm install
```

Expected: `@jdm/tsconfig` appears under `pnpm list -r --depth -1`.

- [ ] **Step 7: Commit**

```bash
git add packages/tsconfig pnpm-lock.yaml
git commit -m "chore: add shared tsconfig package"
```

---

## Task 3: Shared lint + format config (roadmap 0.3)

**Files:**

- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `.lintstagedrc.json`
- Modify: `package.json` (add lint deps + prepare script)

- [ ] **Step 1: Install lint/format + hook deps at root**

```bash
pnpm add -D -w eslint@^9.15.0 typescript-eslint@^8.17.0 @eslint/js@^9.15.0 \
  eslint-config-prettier@^9.1.0 eslint-plugin-import@^2.31.0 \
  lint-staged@^15.2.10 simple-git-hooks@^2.11.1
```

- [ ] **Step 2: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 3: Create `.prettierignore`**

```
node_modules/
dist/
build/
.next/
.expo/
.turbo/
coverage/
pnpm-lock.yaml
packages/db/prisma/migrations/
```

- [ ] **Step 4: Create `eslint.config.js` (flat config)**

```js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/db/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
    },
  },
  {
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
```

Notes: `projectService.allowDefaultProject: ['*.js']` lets ESLint type-check `eslint.config.js` itself without a bespoke tsconfig. The final override scopes three `no-unsafe-*` rules off inside `eslint.config.js` only — the `typescript-eslint` / `eslint-plugin-import` spread APIs return `any`-typed values that would self-trigger those rules otherwise.

- [ ] **Step 5: Create `.lintstagedrc.json`**

```json
{
  "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
```

- [ ] **Step 6: Add root scripts + `simple-git-hooks` config + `"type": "module"`**

Modify `package.json`: set `"type": "module"` (required because `eslint.config.js` uses ESM `import`), replace the `scripts` block, and add the `simple-git-hooks` config. Preserve `name`, `private`, `version`, `packageManager`, `engines` (with both `node` and `pnpm` pins), and `devDependencies`.

Target additions:

```json
{
  "type": "module",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,json,md}\"",
    "prepare": "simple-git-hooks"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged"
  }
}
```

- [ ] **Step 7: Install hook + verify lint passes on empty tree**

```bash
pnpm install
pnpm lint
pnpm format:check
```

Expected: both commands exit 0 (nothing to lint/check yet).

- [ ] **Step 8: Sanity-check hook wiring**

```bash
ls .git/hooks/pre-commit
```

Expected: file exists and contains `pnpm lint-staged`.

- [ ] **Step 9: Commit**

```bash
git add eslint.config.js .prettierrc .prettierignore .lintstagedrc.json package.json pnpm-lock.yaml
git commit -m "chore: add shared eslint, prettier, and pre-commit hook"
```

---

## Task 4: `packages/shared` (roadmap 0.4)

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/ids.ts`
- Create: `packages/shared/src/auth.ts`
- Create: `packages/shared/src/events.ts`
- Create: `packages/shared/src/health.ts`
- Create: `packages/shared/test/ids.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@jdm/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./auth": "./src/auth.ts",
    "./events": "./src/events.ts",
    "./health": "./src/health.ts",
    "./ids": "./src/ids.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@jdm/tsconfig": "workspace:*",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "@jdm/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Note: `module`/`moduleResolution` are overridden to `Bundler` because this package is source-only (`main` resolves to `src/index.ts`, consumed by bundlers and Vitest without a build step). The base `node.json` sets `NodeNext`, which would require `.js` extensions on every relative import. Add `"@types/node": "^22.10.0"` to `devDependencies` as well — the base `node.json` declares `types: ["node"]`.

- [ ] **Step 3: Write failing test `packages/shared/test/ids.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { userId, eventId } from '../src/ids';

describe('branded id helpers', () => {
  it('userId accepts a non-empty string and returns a branded UserId', () => {
    const id = userId('usr_123');
    expect(id).toBe('usr_123');
  });

  it('userId rejects an empty string', () => {
    expect(() => userId('')).toThrow(/non-empty/);
  });

  it('eventId accepts a non-empty string', () => {
    expect(eventId('evt_abc')).toBe('evt_abc');
  });
});
```

- [ ] **Step 4: Run the failing test**

```bash
pnpm --filter @jdm/shared test
```

Expected: FAIL — `src/ids.ts` does not exist.

- [ ] **Step 5: Implement `packages/shared/src/ids.ts`**

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type EventId = Brand<string, 'EventId'>;
export type TicketId = Brand<string, 'TicketId'>;
export type OrderId = Brand<string, 'OrderId'>;

const assertNonEmpty = (value: string, label: string): void => {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
};

export const userId = (value: string): UserId => {
  assertNonEmpty(value, 'UserId');
  return value as UserId;
};

export const eventId = (value: string): EventId => {
  assertNonEmpty(value, 'EventId');
  return value as EventId;
};

export const ticketId = (value: string): TicketId => {
  assertNonEmpty(value, 'TicketId');
  return value as TicketId;
};

export const orderId = (value: string): OrderId => {
  assertNonEmpty(value, 'OrderId');
  return value as OrderId;
};
```

- [ ] **Step 6: Stub the remaining modules (empty but importable)**

`packages/shared/src/auth.ts`:

```ts
// Auth schemas land here in F1 (see roadmap 1.1). Intentionally empty in Phase 0.
export {};
```

`packages/shared/src/events.ts`:

```ts
// Event schemas land here in F3 (see roadmap 3.1). Intentionally empty in Phase 0.
export {};
```

`packages/shared/src/health.ts`:

```ts
import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  sha: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
```

`packages/shared/src/index.ts`:

```ts
export * from './ids';
export * from './health';
```

- [ ] **Step 7: Re-run tests**

```bash
pnpm install
pnpm --filter @jdm/shared test
pnpm --filter @jdm/shared typecheck
```

Expected: all tests pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add branded id helpers and health schema"
```

---

## Task 5: `packages/db` — Prisma base (roadmap 0.5)

**Approach:** Use `prisma init` to generate `schema.prisma` + `.env` with the right provider block, then patch.

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Scaffold then patch: `packages/db/prisma/schema.prisma` (via `prisma init`)
- Scaffold: `packages/db/.env` (via `prisma init`; copy to `.env.example`, gitignore the original)
- Create: `packages/db/src/index.ts`
- Create: `docker-compose.yml` (repo root)

- [ ] **Step 1: Create `docker-compose.yml` at repo root**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: jdm-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: jdm
      POSTGRES_PASSWORD: jdm
      POSTGRES_DB: jdm
    ports:
      - '5433:5432'
    volumes:
      - jdm_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U jdm -d jdm']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  jdm_pg_data:
```

**Port note:** host port is `5433` (not `5432`) to dodge collisions with a Homebrew Postgres that may already be listening on `5432`. The container listens internally on `5432`. Every local `.env.example` (db, api) references `localhost:5433`. CI (Task 11) runs Postgres on a clean GitHub Actions service container, so CI keeps `5432:5432` and the API CI env uses `localhost:5432`.

- [ ] **Step 2: Create `packages/db/package.json`**

```json
{
  "name": "@jdm/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:reset": "prisma migrate reset --force"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0"
  },
  "devDependencies": {
    "@jdm/tsconfig": "workspace:*",
    "prisma": "^6.1.0",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "@jdm/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

Note: `module`/`moduleResolution` are overridden to `Bundler` because this is a source-only package (`main` points at `src/index.ts`, consumed by Vitest/Next/Metro without a build step). The base `node.json` sets `NodeNext` which would require `.js` extensions on imports — wrong for source-only packages.

- [ ] **Step 4: Install workspace deps, then run `prisma init`**

```bash
pnpm install
pnpm --filter @jdm/db exec prisma init --datasource-provider postgresql
```

Expected: creates `packages/db/prisma/schema.prisma` with a Postgres provider stub and `packages/db/.env` containing a placeholder `DATABASE_URL`. It will also print a next-steps hint — ignore it; we patch below.

- [ ] **Step 5: Patch `packages/db/prisma/schema.prisma`** (add binaryTargets + placeholder User)

Replace the scaffolded file with:

```prisma
// Phase 0 placeholder. Real models land in F1+ (roadmap 1.1 onwards).
// The generator must run so downstream packages can import @prisma/client types.

generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
}
```

- [ ] **Step 5b: Turn the scaffolded `.env` into a committed `.env.example`**

```bash
mv packages/db/.env packages/db/.env.example
```

Edit `packages/db/.env.example` so it matches:

```
DATABASE_URL="postgresql://jdm:jdm@localhost:5433/jdm?schema=public"
```

Then recreate the ignored working copy:

```bash
cp packages/db/.env.example packages/db/.env
```

(Root `.gitignore` from Task 1 already ignores `.env` files except `.env.example`, so the working copy won't be tracked.)

- [ ] **Step 6: Create `packages/db/src/index.ts`**

```ts
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export type { Prisma, User } from '@prisma/client';
```

- [ ] **Step 7: Start local Postgres + run initial migration**

```bash
docker compose up -d postgres
pnpm --filter @jdm/db exec prisma migrate dev --name init
pnpm --filter @jdm/db db:generate
```

Expected: a migration directory `packages/db/prisma/migrations/<timestamp>_init/migration.sql` is created with a `CREATE TABLE "User"` statement; `@prisma/client` types are generated.

- [ ] **Step 8: Typecheck the package**

```bash
pnpm --filter @jdm/db typecheck
```

Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml packages/db pnpm-lock.yaml
git commit -m "feat(db): bootstrap prisma with placeholder User model"
```

---

## Task 6: `apps/api` — Fastify skeleton (roadmap 0.6)

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/Dockerfile`
- Create: `apps/api/.dockerignore`
- Create: `apps/api/.env.example`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/logger.ts`
- Create: `apps/api/src/plugins/request-id.ts`
- Create: `apps/api/src/plugins/sentry.ts`
- Create: `apps/api/src/plugins/error-handler.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@jdm/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/sensible": "^6.0.1",
    "@jdm/db": "workspace:*",
    "@jdm/shared": "workspace:*",
    "@sentry/node": "^8.42.0",
    "fastify": "^5.1.0",
    "fastify-plugin": "^5.0.1",
    "pino": "^9.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@jdm/tsconfig": "workspace:*",
    "@types/node": "^22.10.0",
    "pino-pretty": "^13.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "@jdm/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create `apps/api/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": false,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*", "**/*.test.ts"]
}
```

- [ ] **Step 4: Create `apps/api/.env.example`**

```
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
DATABASE_URL="postgresql://jdm:jdm@localhost:5433/jdm?schema=public"
SENTRY_DSN=
GIT_SHA=dev
CORS_ORIGINS=http://localhost:3000,http://localhost:8081
```

- [ ] **Step 5: Create `apps/api/src/env.ts`**

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  SENTRY_DSN: z.string().optional(),
  GIT_SHA: z.string().default('dev'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(flat)}`);
  }
  return parsed.data;
};
```

- [ ] **Step 6: Create `apps/api/src/logger.ts`**

```ts
import pino, { type LoggerOptions } from 'pino';

import type { Env } from './env';

export const buildLoggerOptions = (env: Env): LoggerOptions => ({
  level: env.LOG_LEVEL,
  base: { service: 'api', sha: env.GIT_SHA },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

export const createLogger = (env: Env) => pino(buildLoggerOptions(env));
```

- [ ] **Step 7: Create `apps/api/src/plugins/request-id.ts`**

```ts
import { randomUUID } from 'node:crypto';

import fp from 'fastify-plugin';

export const requestIdPlugin = fp(async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    request.id = id;
    void reply.header('x-request-id', id);
  });
});
```

- [ ] **Step 8: Create `apps/api/src/plugins/sentry.ts`**

```ts
import * as Sentry from '@sentry/node';
import fp from 'fastify-plugin';

import type { Env } from '../env';

export const sentryPlugin = fp<{ env: Env }>(async (app, opts) => {
  if (!opts.env.SENTRY_DSN) {
    app.log.info('Sentry disabled (no SENTRY_DSN)');
    return;
  }

  Sentry.init({
    dsn: opts.env.SENTRY_DSN,
    environment: opts.env.NODE_ENV,
    release: opts.env.GIT_SHA,
    tracesSampleRate: 0.1,
  });

  app.addHook('onError', async (request, _reply, error) => {
    Sentry.withScope((scope) => {
      scope.setTag('request_id', request.id);
      Sentry.captureException(error);
    });
  });
});
```

- [ ] **Step 9: Create `apps/api/src/plugins/error-handler.ts`**

```ts
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, reqId: request.id }, 'request failed');

    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'ValidationError', issues: error.flatten() });
    }

    const statusCode = error.statusCode ?? 500;
    const expose = statusCode < 500;
    return reply.status(statusCode).send({
      error: expose ? error.name : 'InternalServerError',
      message: expose ? error.message : 'Something went wrong',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ error: 'NotFound', path: request.url });
  });
});
```

- [ ] **Step 10: Create `apps/api/src/routes/health.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';

import { healthResponseSchema } from '@jdm/shared/health';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const payload = {
      status: 'ok' as const,
      sha: process.env.GIT_SHA ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
    };
    return healthResponseSchema.parse(payload);
  });
};
```

- [ ] **Step 11: Create `apps/api/src/app.ts`**

```ts
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';

import { type Env } from './env';
import { buildLoggerOptions } from './logger';
import { errorHandlerPlugin } from './plugins/error-handler';
import { requestIdPlugin } from './plugins/request-id';
import { sentryPlugin } from './plugins/sentry';
import { healthRoutes } from './routes/health';

export const buildApp = async (env: Env): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: buildLoggerOptions(env),
    disableRequestLogging: false,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(requestIdPlugin);
  await app.register(sentryPlugin, { env });
  await app.register(sensible);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });
  await app.register(errorHandlerPlugin);
  await app.register(healthRoutes);

  return app;
};
```

- [ ] **Step 12: Create `apps/api/src/server.ts`**

```ts
import { loadEnv } from './env';
import { buildApp } from './app';

const main = async () => {
  const env = loadEnv();
  const app = await buildApp(env);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutdown initiated');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 13: Create `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @jdm/db db:generate
RUN pnpm --filter @jdm/api build

FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/apps/api/dist /app/dist
COPY --from=build /repo/apps/api/package.json /app/package.json
COPY --from=build /repo/packages /app/packages
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 14: Create `apps/api/.dockerignore`**

```
node_modules
dist
.turbo
.env
.env.*
coverage
*.log
```

- [ ] **Step 15: Smoke-test the server locally**

```bash
cp apps/api/.env.example apps/api/.env
pnpm --filter @jdm/db db:generate
pnpm --filter @jdm/api dev &
sleep 3
curl -s http://localhost:4000/health | tee /tmp/health.json
kill %1 || true
```

Expected: `/tmp/health.json` contains `{"status":"ok","sha":"dev","uptimeSeconds":<n>}` and response headers include `x-request-id`.

- [ ] **Step 16: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): fastify skeleton with /health, env, logger, request-id, sentry hooks"
```

---

## Task 7: `apps/api` — integration test harness (roadmap 0.7)

**Files:**

- Modify: `apps/api/package.json` (add deps)
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/test/setup.ts`
- Create: `apps/api/test/health.test.ts`

- [ ] **Step 1: Add Testcontainers + supertest-style deps**

```bash
pnpm --filter @jdm/api add -D \
  @testcontainers/postgresql@^10.13.0 \
  testcontainers@^10.13.0 \
  @types/node@^22.10.0
```

- [ ] **Step 2: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
```

- [ ] **Step 3: Create `apps/api/test/setup.ts`**

```ts
import { execSync } from 'node:child_process';
import path from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll } from 'vitest';

let container: StartedPostgreSqlContainer | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('jdm_test')
    .withUsername('jdm')
    .withPassword('jdm')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.GIT_SHA = 'test';
  process.env.CORS_ORIGINS = '';

  const dbPackageDir = path.resolve(__dirname, '../../../packages/db');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}, 120_000);

afterAll(async () => {
  await container?.stop();
});
```

- [ ] **Step 4: Write the failing test `apps/api/test/health.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import { healthResponseSchema } from '@jdm/shared/health';

describe('GET /health', () => {
  it('returns ok and a valid payload', async () => {
    const app = await buildApp(loadEnv());
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const parsed = healthResponseSchema.parse(response.json());
      expect(parsed.status).toBe('ok');
      expect(response.headers['x-request-id']).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('assigns a request id per request', async () => {
    const app = await buildApp(loadEnv());
    try {
      const a = await app.inject({ method: 'GET', url: '/health' });
      const b = await app.inject({ method: 'GET', url: '/health' });
      expect(a.headers['x-request-id']).not.toEqual(b.headers['x-request-id']);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 5: Run tests — must go green (Testcontainers spins up Postgres)**

```bash
pnpm --filter @jdm/api test
```

Expected: both tests PASS; a container `postgres:16-alpine` spins up and is torn down.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "test(api): add vitest + testcontainers harness with /health integration test"
```

---

## Task 8: `apps/mobile` — Expo skeleton (roadmap 0.8)

**Approach:** Use `create-expo-app` with the `default` template — it ships Expo Router pre-wired, real 1024×1024 icon/splash/adaptive-icon PNGs, the correct `babel.config.js`, a working `app.json`, and the `expo-router/entry` main. Then patch for our monorepo (metro config, workspace package name, app.config.ts with variants, our screens).

**Files after this task:**

- Scaffolded: `apps/mobile/package.json` (patched), `babel.config.js`, `assets/*` (kept), `tsconfig.json` (replaced), `.gitignore` (kept), `app.json` (deleted — replaced by `app.config.ts`)
- Replaced: `apps/mobile/app/_layout.tsx`, `app/index.tsx`
- Added: `apps/mobile/metro.config.js`, `app.config.ts`, `.env.example`, `src/api/client.ts`, `src/theme/index.ts`, `src/components/Button.tsx`

- [ ] **Step 1: Scaffold with `create-expo-app`**

```bash
pnpm dlx create-expo-app@latest apps/mobile --template default --no-install
```

Expected: creates `apps/mobile/` containing `package.json`, `tsconfig.json`, `app.json`, `babel.config.js`, `assets/` (icon, splash, adaptive-icon, favicon), `app/(tabs)/` sample screens, `.gitignore`, and `expo-env.d.ts`.

- [ ] **Step 2: Strip the sample screens + favicon**

```bash
rm -rf apps/mobile/app/\(tabs\) apps/mobile/app/+not-found.tsx apps/mobile/app/+html.tsx apps/mobile/components apps/mobile/hooks apps/mobile/constants apps/mobile/scripts 2>/dev/null || true
rm -f apps/mobile/assets/favicon.png apps/mobile/README.md
# Keep: apps/mobile/assets/{icon.png,splash.png,adaptive-icon.png}
ls apps/mobile/assets
```

Expected: `apps/mobile/assets` contains `icon.png`, `splash.png` (or `splash-icon.png`, depending on template version), and `adaptive-icon.png`. If `splash-icon.png` is present but not `splash.png`, rename it: `mv apps/mobile/assets/splash-icon.png apps/mobile/assets/splash.png`.

- [ ] **Step 3: Replace `apps/mobile/package.json`** (rename to `@jdm/mobile`, add workspace deps, trim)

Keep the scaffolded `dependencies` version pins (they match the installed Expo SDK), but rewrite `name`, `main`, `scripts`, and add workspace deps + zod. Target state:

```json
{
  "name": "@jdm/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "dev": "expo start",
    "start": "expo start",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "typecheck": "tsc --noEmit",
    "lint": "eslint app src",
    "test": "vitest run"
  },
  "dependencies": {
    "@jdm/shared": "workspace:*",
    "expo": "~52.0.0",
    "expo-constants": "~17.0.3",
    "expo-linking": "~7.0.3",
    "expo-router": "~4.0.0",
    "expo-status-bar": "~2.0.0",
    "react": "18.3.1",
    "react-native": "0.76.0",
    "react-native-safe-area-context": "4.12.0",
    "react-native-screens": "~4.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@jdm/tsconfig": "workspace:*",
    "@babel/core": "^7.25.0",
    "@types/react": "~18.3.12",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

If the scaffolder's pinned versions differ, prefer the scaffolder's pins (they match the installed SDK). Only the `name`, `main`, `scripts`, and the addition of `@jdm/shared`/`@jdm/tsconfig`/`zod` must match above.

- [ ] **Step 4: Replace `apps/mobile/tsconfig.json`** (extend our shared config)

```json
{
  "extends": "@jdm/tsconfig/react-native.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "~/*": ["src/*"] }
  },
  "include": ["app/**/*", "src/**/*", "app.config.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 5: Keep the scaffolded `babel.config.js`** — no change needed. Verify it contains:

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
```

If the scaffolder produced something else, replace with the above.

- [ ] **Step 6: Create `apps/mobile/metro.config.js`** (monorepo-aware — scaffolder does NOT add this)

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

- [ ] **Step 7: Replace `apps/mobile/app.json` with `apps/mobile/app.config.ts`**

```bash
rm apps/mobile/app.json
```

Then create `apps/mobile/app.config.ts`:

```ts
import type { ExpoConfig } from 'expo/config';

type Variant = 'development' | 'preview' | 'production';

const variantFromEnv = (): Variant => {
  const raw = process.env.APP_VARIANT ?? 'development';
  if (raw === 'development' || raw === 'preview' || raw === 'production') return raw;
  return 'development';
};

const variant = variantFromEnv();

const suffix: Record<Variant, string> = {
  development: ' (Dev)',
  preview: ' (Preview)',
  production: '',
};

const bundleId: Record<Variant, string> = {
  development: 'com.jdmexperience.app.dev',
  preview: 'com.jdmexperience.app.preview',
  production: 'com.jdmexperience.app',
};

const config: ExpoConfig = {
  name: `JDM Experience${suffix[variant]}`,
  slug: 'jdm-experience',
  scheme: 'jdm',
  version: '0.0.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0B0B0F',
  },
  ios: {
    bundleIdentifier: bundleId[variant],
    supportsTablet: false,
  },
  android: {
    package: bundleId[variant],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B0B0F',
    },
  },
  plugins: ['expo-router'],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
};

export default config;
```

- [ ] **Step 8: Create `apps/mobile/.env.example`**

```
APP_VARIANT=development
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
EAS_PROJECT_ID=
```

- [ ] **Step 9: Create `apps/mobile/src/theme/index.ts`**

```ts
export const theme = {
  colors: {
    bg: '#0B0B0F',
    fg: '#F5F5F7',
    accent: '#E10600',
    muted: '#8A8A93',
    border: '#1F1F24',
  },
  radii: { sm: 4, md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  font: {
    family: { regular: 'System', bold: 'System' },
    size: { sm: 12, md: 14, lg: 16, xl: 20, xxl: 28 },
  },
} as const;

export type Theme = typeof theme;
```

- [ ] **Step 10: Create `apps/mobile/src/components/Button.tsx`**

```tsx
import { Pressable, StyleSheet, Text } from 'react-native';
import type { PressableProps } from 'react-native';

import { theme } from '../theme';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary';
};

export const Button = ({ label, variant = 'primary', ...rest }: Props) => {
  const bg = variant === 'primary' ? theme.colors.accent : 'transparent';
  const fg = variant === 'primary' ? theme.colors.fg : theme.colors.fg;
  const borderColor = variant === 'secondary' ? theme.colors.border : bg;

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderColor, opacity: pressed ? 0.8 : 1 },
      ]}
      {...rest}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: theme.font.size.lg,
    fontWeight: '600',
  },
});
```

- [ ] **Step 11: Create `apps/mobile/src/api/client.ts`**

```ts
import Constants from 'expo-constants';
import { z } from 'zod';

import { healthResponseSchema, type HealthResponse } from '@jdm/shared/health';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
const DEFAULT_BASE = 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const request = async <T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> => {
  const base = extra.apiBaseUrl ?? DEFAULT_BASE;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`);
  }
  const json: unknown = await response.json();
  return schema.parse(json);
};

export const api = {
  health: (): Promise<HealthResponse> => request('/health', healthResponseSchema),
};
```

- [ ] **Step 12: Replace `apps/mobile/app/_layout.tsx`** (scaffolder created a placeholder; overwrite)

```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { theme } from '~/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.bg },
          headerTintColor: theme.colors.fg,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      />
    </>
  );
}
```

- [ ] **Step 13: Create `apps/mobile/app/index.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '~/api/client';
import { Button } from '~/components/Button';
import { theme } from '~/theme';

type HealthState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; sha: string; uptime: number }
  | { kind: 'error'; message: string };

export default function HomeScreen() {
  const [state, setState] = useState<HealthState>({ kind: 'idle' });

  const check = async () => {
    setState({ kind: 'loading' });
    try {
      const result = await api.health();
      setState({ kind: 'ok', sha: result.sha, uptime: result.uptimeSeconds });
    } catch (err) {
      const message = err instanceof ApiError ? `HTTP ${err.status}` : 'Network error';
      setState({ kind: 'error', message });
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JDM Experience</Text>
      <Text style={styles.subtitle}>API health</Text>
      {state.kind === 'loading' && <Text style={styles.body}>Checking…</Text>}
      {state.kind === 'ok' && (
        <Text style={styles.body}>
          OK · sha {state.sha} · up {state.uptime}s
        </Text>
      )}
      {state.kind === 'error' && <Text style={styles.error}>Error: {state.message}</Text>}
      <Button label="Re-check" onPress={check} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  subtitle: { color: theme.colors.muted, fontSize: theme.font.size.md },
  body: { color: theme.colors.fg, fontSize: theme.font.size.lg },
  error: { color: theme.colors.accent, fontSize: theme.font.size.lg },
});
```

- [ ] **Step 14: Typecheck + sanity-run Metro**

```bash
cp apps/mobile/.env.example apps/mobile/.env
pnpm install
pnpm --filter @jdm/mobile typecheck
pnpm --filter @jdm/mobile exec expo-doctor || true
```

Expected: `typecheck` exits 0; `expo-doctor` should pass (assets already real, not placeholders).

- [ ] **Step 15: Commit**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): scaffold expo router app via create-expo-app and wire monorepo + api client"
```

---

## Task 9: `apps/mobile` — EAS configuration (roadmap 0.9)

**Approach:** Use `eas init` to link the Expo project (writes `EAS_PROJECT_ID` under `extra.eas.projectId`), then `eas build:configure` to generate a default `eas.json`, then patch to our three profiles.

**Files:**

- Scaffold then patch: `apps/mobile/eas.json` (via `eas build:configure`)
- Scaffold side effect: `apps/mobile/app.config.ts` gets `extra.eas.projectId` populated (or you set `EAS_PROJECT_ID` env instead)
- Create: `docs/eas-credentials.md`

- [ ] **Step 1: Install EAS CLI as a root devDep**

```bash
pnpm add -D -w eas-cli@^14.0.0
```

- [ ] **Step 2: Log in to Expo + initialize the EAS project**

Run from a terminal with interactive TTY (one-time, per developer):

```bash
pnpm dlx eas-cli login
pnpm --filter @jdm/mobile exec eas init --non-interactive
```

Expected: a project is created or linked in expo.dev. The command prints an `EAS_PROJECT_ID` (a UUID) and writes it into `app.config.ts`'s `extra.eas.projectId` (or prompts you to paste it in).

If the CLI populated `extra.eas.projectId` with a literal string, replace it with the env-driven reference already in `app.config.ts` from Task 8 (`projectId: process.env.EAS_PROJECT_ID ?? ''`) and instead add the UUID to `apps/mobile/.env` as `EAS_PROJECT_ID=<uuid>`. Commit only the `.env.example` reminder, not `.env`.

- [ ] **Step 3: Generate default `eas.json`**

```bash
pnpm --filter @jdm/mobile exec eas build:configure --platform all
```

Expected: creates `apps/mobile/eas.json` with `development` / `preview` / `production` profiles.

- [ ] **Step 4: Replace `apps/mobile/eas.json` with our profiles**

Overwrite the scaffolded file with:

```json
{
  "cli": { "version": ">= 14.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true },
      "env": { "APP_VARIANT": "development" }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" },
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "channel": "production",
      "autoIncrement": true,
      "env": { "APP_VARIANT": "production" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "$APPLE_ID", "ascAppId": "$ASC_APP_ID" },
      "android": { "serviceAccountKeyPath": "./secrets/play-service-account.json" }
    }
  }
}
```

- [ ] **Step 5: Create `docs/eas-credentials.md`**

```markdown
# EAS credentials checklist

Everything below is obtained once per environment and stored in EAS's hosted
credential store — never committed.

## Apple (iOS)

- Apple Developer Program membership ($99/yr).
- App Store Connect app records for each bundle identifier:
  - `com.jdmexperience.app.dev` (development)
  - `com.jdmexperience.app.preview` (TestFlight internal)
  - `com.jdmexperience.app` (production)
- Distribution certificate + provisioning profile per bundle id (EAS can
  generate and host these; run `eas credentials` once per profile).
- App Store Connect API key (`.p8`, Key ID, Issuer ID) for `eas submit`.
- `APPLE_ID` + `ASC_APP_ID` set as EAS secrets for the `production` submit
  profile.

## Google (Android)

- Google Play Console account + app record for `com.jdmexperience.app`.
- Play Console service account JSON with "Release manager" role, uploaded
  via `eas credentials` (never commit the JSON).
- Upload keystore generated and stored in EAS.

## Expo

- `EAS_PROJECT_ID` populated in EAS dashboard, mirrored to `apps/mobile/.env`
  and GitHub Actions secrets.

## Verification

- `eas build --profile development --platform ios --local` dry-run succeeds.
- `eas build --profile preview --platform ios` produces a TestFlight-ready IPA.
- `eas build --profile preview --platform android` produces an installable APK.
```

- [ ] **Step 6: Commit**

```bash
mkdir -p docs
git add apps/mobile/eas.json apps/mobile/app.config.ts apps/mobile/.env.example docs/eas-credentials.md package.json pnpm-lock.yaml
git commit -m "chore(mobile): link eas project, add build profiles and credentials doc"
```

---

## Task 10: `apps/admin` — Next.js skeleton (roadmap 0.10)

**Approach:** Use `create-next-app` with non-interactive flags to scaffold the App Router, Tailwind, ESLint, and `~/*` import alias. Then patch `tsconfig.json` to extend `@jdm/tsconfig`, add workspace deps, and replace the sample page with our health-fetch page.

**Files after this task:**

- Scaffolded: `apps/admin/package.json` (patched), `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts` (patched), `app/layout.tsx`, `app/globals.css` (patched), `tsconfig.json` (patched), `next-env.d.ts`, `.eslintrc.json` (kept; Task 3's root eslint takes precedence for repo-wide runs)
- Replaced: `apps/admin/app/page.tsx`
- Added: `apps/admin/app/api/health/route.ts`, `apps/admin/src/lib/api.ts`, `apps/admin/.env.example`

- [ ] **Step 1: Scaffold with `create-next-app`**

```bash
pnpm create next-app@latest apps/admin \
  --typescript \
  --tailwind \
  --app \
  --eslint \
  --no-src-dir \
  --import-alias "~/*" \
  --use-pnpm \
  --skip-install \
  --no-turbopack
```

Expected: creates `apps/admin/` with `package.json` (name `admin`), `next.config.*`, `postcss.config.*`, `tailwind.config.*`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `tsconfig.json`, `.eslintrc.json`, `next-env.d.ts`.

- [ ] **Step 2: Patch `apps/admin/package.json`** (rename + add workspace deps)

Change `name` to `@jdm/admin` and add the marked entries. Keep the scaffolded version pins for `next`, `react`, `react-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/*`, `eslint`, `eslint-config-next`, `typescript`. Target fields (merge, do not wholesale replace):

```json
{
  "name": "@jdm/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit",
    "lint": "eslint app src",
    "test": "vitest run"
  },
  "dependencies": {
    "@jdm/shared": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@jdm/tsconfig": "workspace:*",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Replace `apps/admin/tsconfig.json`** (extend our shared config; keep Next's plugin entry)

```json
{
  "extends": "@jdm/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "~/*": ["./src/*"] },
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Replace `apps/admin/next.config.*`** with `next.config.mjs`

```bash
rm -f apps/admin/next.config.js apps/admin/next.config.ts apps/admin/next.config.mjs
```

Then create `apps/admin/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@jdm/shared'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  },
};

export default config;
```

- [ ] **Step 5: Patch `apps/admin/tailwind.config.ts`** (extend content globs + add our colors)

Replace the scaffolded file with:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0B0F',
        fg: '#F5F5F7',
        accent: '#E10600',
        muted: '#8A8A93',
        border: '#1F1F24',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 6: Replace `apps/admin/app/globals.css`** (scaffolder creates one with Tailwind directives; overwrite with our base styles)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body {
  background-color: #0b0b0f;
  color: #f5f5f7;
  min-height: 100%;
}
```

- [ ] **Step 7: Create `apps/admin/src/lib/api.ts`**

```ts
import { healthResponseSchema, type HealthResponse } from '@jdm/shared/health';

const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const fetchHealth = async (): Promise<HealthResponse> => {
  const response = await fetch(`${base}/health`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`API /health responded ${response.status}`);
  }
  const json: unknown = await response.json();
  return healthResponseSchema.parse(json);
};
```

- [ ] **Step 8: Replace `apps/admin/app/layout.tsx`** (scaffolder created a placeholder; overwrite)

```tsx
import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'JDM Experience · Admin',
  description: 'Organizer console for JDM Experience',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Replace `apps/admin/app/page.tsx`** (scaffolder created a sample; overwrite with server component)

```tsx
import { fetchHealth } from '~/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let status: string;
  try {
    const health = await fetchHealth();
    status = `OK · sha ${health.sha} · up ${health.uptimeSeconds}s`;
  } catch (err) {
    status = err instanceof Error ? `Error: ${err.message}` : 'Unknown error';
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">JDM Experience · Admin</h1>
      <p className="text-muted">API health (server-fetched)</p>
      <p className="text-lg">{status}</p>
    </main>
  );
}
```

- [ ] **Step 10: Create `apps/admin/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const GET = () =>
  NextResponse.json({
    status: 'ok',
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    uptimeSeconds: Math.round(process.uptime()),
  });
```

- [ ] **Step 11: Create `apps/admin/.env.example`**

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

- [ ] **Step 12: Install + verify build**

```bash
cp apps/admin/.env.example apps/admin/.env.local
pnpm install
pnpm --filter @jdm/admin typecheck
pnpm --filter @jdm/admin build
```

Expected: `.next/` produced; no type errors.

- [ ] **Step 13: Smoke-run the server (optional)**

```bash
pnpm --filter @jdm/admin dev &
sleep 4
curl -s http://localhost:3000/api/health | tee /tmp/admin-health.json
kill %1 || true
```

Expected: `/tmp/admin-health.json` matches `{"status":"ok",...}`.

- [ ] **Step 14: Commit**

```bash
git add apps/admin pnpm-lock.yaml
git commit -m "feat(admin): next.js app router skeleton with tailwind and api health proxy"
```

---

## Task 11: GitHub Actions CI (roadmap 0.11)

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-typecheck-test:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: jdm
          POSTGRES_PASSWORD: jdm
          POSTGRES_DB: jdm
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U jdm"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgresql://jdm:jdm@localhost:5432/jdm?schema=public

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.4.1

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter @jdm/db db:generate

      - run: pnpm --filter @jdm/db exec prisma migrate deploy

      - run: pnpm lint

      - run: pnpm format:check

      - run: pnpm typecheck

      - run: pnpm test

      - run: pnpm build

  expo-prebuild-check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.4.1 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @jdm/mobile typecheck
      - run: pnpm --filter @jdm/mobile exec expo config --type public
```

- [ ] **Step 2: Verify workflow lints locally**

```bash
pnpm exec eslint .github || true  # eslint doesn't cover yaml; next check:
pnpm dlx action-validator .github/workflows/ci.yml || true
```

Expected: no blocking errors. Any warnings captured for follow-up; CI itself is the real verification.

- [ ] **Step 3: Deliberately break + verify CI fails (manual sanity check)**

Before committing the CI file, temporarily introduce a lint error in one file, push to a throwaway branch, confirm CI fails, then revert:

```bash
printf "\nconst _x: number = 'bad'\n" >> apps/api/src/server.ts
git checkout -b ci-smoke
git add .github apps/api/src/server.ts
git commit -m "ci: temp smoke-test (do not merge)"
git push -u origin ci-smoke
# Wait for CI on GitHub, confirm it fails typecheck.
git checkout -
git branch -D ci-smoke
git push origin --delete ci-smoke || true
# Now revert the temp edit:
git checkout apps/api/src/server.ts
```

(If the repo has no remote CI runs yet because there are no GitHub secrets, skip the push and trust the next PR.)

- [ ] **Step 4: Commit the real workflow**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint/typecheck/test/build pipeline across workspaces"
```

---

## Task 12: Railway deploy — API + Postgres (roadmap 0.12)

**Files:**

- Create: `RAILWAY.md`
- Create: `railway.json`
- Modify: `apps/api/package.json` (add `start:migrate` script)

- [ ] **Step 1: Add `start:migrate` script to `apps/api/package.json`**

Add to `scripts`:

```json
"start:migrate": "pnpm --filter @jdm/db db:deploy && node dist/server.js"
```

- [ ] **Step 2: Create `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/api/Dockerfile"
  },
  "deploy": {
    "preDeployCommand": "node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma",
    "startCommand": "node apps/api/dist/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "numReplicas": 1
  }
}
```

- [ ] **Step 3: Create `RAILWAY.md`**

```markdown
# Railway deploy

## One-time setup

1. Create a Railway project `jdm-experience`.
2. Add a **Postgres** plugin — Railway provisions `DATABASE_URL`.
3. Add a **Service** from this GitHub repo; set:
   - Root directory: `/` (monorepo build).
   - Railway reads repo-root `railway.json`; no manual start command override.
   - Build: **Dockerfile** at `apps/api/Dockerfile`.
4. Environment variables (Service → Variables):
   - `DATABASE_URL` — reference from the Postgres plugin.
   - `NODE_ENV=production`
   - `PORT=4000`
   - `LOG_LEVEL=info`
   - `SENTRY_DSN` — from Sentry project (Task 15).
   - `GIT_SHA` — Railway injects `RAILWAY_GIT_COMMIT_SHA`; map via:
     `GIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}`
   - `CORS_ORIGINS` — comma-separated list of admin + mobile domains.
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TICKET_CODE_SECRET`,
     `FIELD_ENCRYPTION_KEY` — required before the API will boot.
5. Networking: generate a public domain. Copy it into admin & mobile env vars.
6. PR environments: enable **PR environments** in Project Settings so every
   PR gets a throwaway service + Postgres branch.

## Verification

- `main` push → deploy completes → `curl https://<domain>/health` returns
  `{"status":"ok","sha":"<commit>",...}`.
- Prisma migrations applied on every deploy (check logs).
- PR environment spins up within ~3 minutes of opening a PR.

## Rollback

- Railway keeps previous builds; hit "Redeploy" on the last good build.
- For a bad migration: `pnpm --filter @jdm/db exec prisma migrate resolve --rolled-back <name>` from a local shell pointed at prod `DATABASE_URL`, then redeploy.
```

- [ ] **Step 4: Commit**

```bash
git add RAILWAY.md railway.json apps/api/package.json
git commit -m "chore(api): add railway deploy config and runbook"
```

- [ ] **Step 5: Perform deploy (manual, one-time)**

Follow `RAILWAY.md` steps 1–6 in the Railway UI, then from a laptop:

```bash
curl -s https://<railway-domain>/health
```

Expected: `{"status":"ok","sha":"<commit>","uptimeSeconds":<n>}`. Tick the roadmap checkbox only after this succeeds.

---

## Task 13: Vercel deploy — Admin (roadmap 0.13)

**Files:**

- Create: `apps/admin/vercel.json`
- Modify: `RAILWAY.md` (cross-link from admin setup doc — see Step 3)

- [ ] **Step 1: Create `apps/admin/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "cd ../.. && pnpm --filter @jdm/admin build",
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "outputDirectory": ".next",
  "framework": "nextjs"
}
```

- [ ] **Step 2: Create `docs/vercel.md`**

```markdown
# Vercel deploy — admin

## One-time setup

1. Create a Vercel project `jdm-admin`, connect the GitHub repo.
2. Root directory: `apps/admin`.
3. Build settings: use `vercel.json` (already committed). Install command
   resolves at the monorepo root so pnpm workspaces work.
4. Environment variables:
   - `NEXT_PUBLIC_API_BASE_URL` — pointed at the Railway API domain.
   - `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (Task 15).
5. Preview deploys: enabled by default per PR.

## Verification

- Open a PR → Vercel preview URL loads, `/` shows API health fetched server-side.
- Production domain loads after merging to `main`.
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/vercel.json docs/vercel.md
git commit -m "chore(admin): add vercel config and deploy runbook"
```

---

## Task 14: Secrets & env management (roadmap 0.14)

**Files:**

- Create: `docs/secrets.md`

- [ ] **Step 1: Create `docs/secrets.md`**

```markdown
# Secrets inventory

| Secret                                                        | Used by                  | Stored in                            | Local source                        | Rotation                                                                  |
| ------------------------------------------------------------- | ------------------------ | ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`                                                | api, db                  | Railway variables (prod/preview)     | `apps/api/.env`, `packages/db/.env` | Rotate by regenerating Postgres plugin creds; redeploy.                   |
| `JWT_ACCESS_SECRET`                                           | api                      | Railway                              | `apps/api/.env`                     | Rotate every 90 days; rolling restart invalidates old access tokens only. |
| `JWT_REFRESH_SECRET`                                          | api                      | Railway                              | `apps/api/.env`                     | Rotate on incident; forces logout for all users.                          |
| `SENTRY_DSN` (api)                                            | api                      | Railway                              | `apps/api/.env`                     | Regenerate in Sentry project → update Railway.                            |
| `SENTRY_DSN` (admin)                                          | admin                    | Vercel                               | `apps/admin/.env.local`             | Same.                                                                     |
| `SENTRY_DSN` (mobile)                                         | mobile                   | EAS secrets                          | `apps/mobile/.env`                  | Same. Requires OTA release.                                               |
| `SENTRY_AUTH_TOKEN`                                           | CI (source map upload)   | GitHub Actions secret + Vercel       | N/A                                 | 180 days.                                                                 |
| `STRIPE_SECRET_KEY`                                           | api                      | Railway                              | `apps/api/.env`                     | Rotate in Stripe dashboard; update Railway; redeploy.                     |
| `STRIPE_WEBHOOK_SECRET`                                       | api                      | Railway                              | `apps/api/.env`                     | Rotated whenever webhook endpoint URL changes.                            |
| `ABACATEPAY_API_KEY`                                          | api                      | Railway                              | `apps/api/.env`                     | Per AbacatePay dashboard.                                                 |
| `ABACATEPAY_WEBHOOK_SECRET`                                   | api                      | Railway                              | `apps/api/.env`                     | Same.                                                                     |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | api                      | Railway                              | `apps/api/.env`                     | Cloudflare dashboard; rotate on incident.                                 |
| `R2_BUCKET` (prod + preview)                                  | api                      | Railway                              | `apps/api/.env`                     | Immutable per environment.                                                |
| `EXPO_TOKEN`                                                  | CI (EAS build)           | GitHub Actions secret                | N/A                                 | Rotate in expo.dev.                                                       |
| `EAS_PROJECT_ID`                                              | mobile                   | Committed to `app.config.ts` via env | `apps/mobile/.env`                  | Immutable.                                                                |
| `APPLE_ID` / `ASC_APP_ID`                                     | EAS submit               | EAS secrets                          | N/A                                 | Per Apple ID lifecycle.                                                   |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`                            | EAS submit               | EAS secrets                          | N/A                                 | Regenerate in Play Console.                                               |
| `RESEND_API_KEY` (or Postmark)                                | api (email verify/reset) | Railway                              | `apps/api/.env`                     | Per provider; low traffic.                                                |
| `GOOGLE_OAUTH_AUDIENCE`                                       | api (F1 Google sign-in)  | Railway                              | `apps/api/.env`                     | Immutable unless client id changes.                                       |
| `APPLE_OAUTH_AUDIENCE`                                        | api (F1 Apple sign-in)   | Railway                              | `apps/api/.env`                     | Immutable unless bundle id changes.                                       |

## New-developer setup

1. `cp apps/api/.env.example apps/api/.env`
2. `cp apps/admin/.env.example apps/admin/.env.local`
3. `cp apps/mobile/.env.example apps/mobile/.env`
4. `cp packages/db/.env.example packages/db/.env`
5. `docker compose up -d postgres`
6. `pnpm install && pnpm --filter @jdm/db db:migrate && pnpm --filter @jdm/db db:generate`
7. `pnpm dev` — runs all three apps via Turbo.
8. Ask the team lead for dev values of any remaining secrets above (most can
   start empty for Phase 0).

## Production secret rotation checklist

- [ ] Update secret in source (Stripe/Sentry/etc.).
- [ ] Update secret in Railway / Vercel / EAS / GitHub Actions.
- [ ] Redeploy affected service.
- [ ] Verify `/health` + a canary endpoint still return 200.
- [ ] Record rotation date in this doc's change log below.

## Change log

- (append entries: `YYYY-MM-DD · secret · rotated by`)
```

- [ ] **Step 2: Commit**

```bash
git add docs/secrets.md
git commit -m "docs: add secrets inventory and rotation runbook"
```

---

## Task 15: Sentry wiring (roadmap 0.15)

**Approach:** API is already wired (Task 6 Step 8). For admin + mobile, run `@sentry/wizard` to install SDKs, generate config files, wrap bundler configs, and set up source-map uploads — then overwrite the generated DSN-flow code to match our env conventions. Keep our `initSentry()` wrapper for mobile so the DSN stays centralized.

**Files:**

- Modify: `apps/api/src/app.ts` (add `/debug/boom` dev-only route; API Sentry plugin from Task 6 Step 8 is unchanged)
- Scaffold via wizard then overwrite: `apps/admin/sentry.client.config.ts`, `apps/admin/sentry.server.config.ts`, `apps/admin/sentry.edge.config.ts`, `apps/admin/next.config.mjs`
- Scaffold via wizard: `apps/admin/.sentryclirc`, `apps/mobile/.sentryclirc` (both committed; contain no secrets — auth token comes from env)
- Wizard-modified: `apps/admin/package.json` (adds `@sentry/nextjs`), `apps/mobile/package.json` (adds `@sentry/react-native`), `apps/mobile/app.config.ts` (adds plugin entry), `apps/mobile/metro.config.js` (wraps export with `getSentryExpoConfig`)
- Create: `apps/mobile/src/lib/sentry.ts`
- Modify: `apps/mobile/app/_layout.tsx` (call `initSentry()`)

- [x] **Step 1: Add the dev-only `/debug/boom` route**

Append to `apps/api/src/app.ts` after the health route registration (inside `buildApp`):

```ts
if (env.NODE_ENV !== 'production') {
  app.get('/debug/boom', async () => {
    throw new Error('intentional boom for Sentry verification');
  });
}
```

- [x] **Step 2: Run `@sentry/wizard` for Next.js (admin)**

The wizard installs `@sentry/nextjs`, generates `sentry.{client,server,edge}.config.ts`, wraps `next.config.mjs` with `withSentryConfig`, and creates `.sentryclirc` for source-map uploads. Requires a Sentry account + auth token (one-time prompt).

```bash
pnpm --filter @jdm/admin dlx @sentry/wizard@latest -i nextjs --saas --signup
```

Expected: wizard completes and prints a checklist. Verify these files exist: `apps/admin/sentry.client.config.ts`, `apps/admin/sentry.server.config.ts`, `apps/admin/sentry.edge.config.ts`, and that `apps/admin/next.config.mjs` imports `withSentryConfig`.

**Patch the generated files** to match our DSN convention below (Steps 3–6). The wizard writes its own defaults — overwrite them.

- [x] **Step 2b: Run `@sentry/wizard` for Expo (mobile)**

```bash
pnpm --filter @jdm/mobile dlx @sentry/wizard@latest -i reactNative --saas
```

Expected: installs `@sentry/react-native`, adds the Sentry plugin to `app.config.ts` (or `app.json`), and creates `.sentryclirc`. It may prompt to modify metro.config.js — accept; our monorepo-aware metro.config.js merges cleanly with the Sentry wrapper (`getSentryExpoConfig`). If the wizard asks to overwrite metro.config.js, review the diff and preserve the monorepo `watchFolders` + `nodeModulesPaths` from Task 8 Step 6.

- [x] **Step 3: Replace `apps/admin/sentry.client.config.ts`** with our DSN convention

```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
```

- [x] **Step 4: Replace `apps/admin/sentry.server.config.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

- [x] **Step 5: Replace `apps/admin/sentry.edge.config.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

- [x] **Step 6: Overwrite wizard-generated `apps/admin/next.config.mjs`** (the wizard's version works but wraps our config differently; pin to this shape)

```js
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@jdm/shared'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  },
};

export default withSentryConfig(config, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_ADMIN,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
```

- [x] **Step 7: Create `apps/mobile/src/lib/sentry.ts`** (wraps `@sentry/react-native` installed by the wizard)

```ts
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

type Extra = { sentryDsn?: string };

export const initSentry = () => {
  const dsn = (Constants.expoConfig?.extra as Extra | undefined)?.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    debug: false,
    tracesSampleRate: 0.1,
  });
};
```

- [x] **Step 8: Call `initSentry()` from `apps/mobile/app/_layout.tsx`**

Replace the file with:

```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { initSentry } from '~/lib/sentry';
import { theme } from '~/theme';

export default function RootLayout() {
  useEffect(() => {
    initSentry();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.bg },
          headerTintColor: theme.colors.fg,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      />
    </>
  );
}
```

- [x] **Step 9: Confirm `apps/mobile/app.config.ts` carries our plugin block + `sentryDsn` extra**

The wizard at Step 2b added `@sentry/react-native/expo` to `plugins`. Merge it with our existing `expo-router` entry and add the `sentryDsn` value. Final shapes of the two blocks:

```ts
  plugins: [
    'expo-router',
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT_MOBILE,
      },
    ],
  ],
  extra: {
    variant,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
```

- [ ] **Step 10: Smoke-test Sentry (manual; Phase 0 gate)**

1. Create three Sentry projects: `jdm-api`, `jdm-admin`, `jdm-mobile`.
2. Put their DSNs in the matching env stores (Railway/Vercel/EAS).
3. Hit `curl https://<railway-domain>/debug/boom` → confirm an event appears
   in `jdm-api`.
4. Trigger a client-side throw on admin (temporarily in `app/page.tsx`) on a
   preview deploy → confirm event in `jdm-admin`, revert.
5. Throw from a button press in the Expo dev build → confirm event in
   `jdm-mobile`, revert.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/app.ts \
        apps/admin/next.config.mjs apps/admin/sentry.*.config.ts apps/admin/.sentryclirc apps/admin/package.json \
        apps/mobile/app.config.ts apps/mobile/app/_layout.tsx apps/mobile/src/lib/sentry.ts apps/mobile/metro.config.js apps/mobile/.sentryclirc apps/mobile/package.json \
        pnpm-lock.yaml
git commit -m "feat: wire sentry across api, admin, and mobile via @sentry/wizard"
```

---

## Task 16: README + CONTRIBUTING (roadmap 0.16)

**Files:**

- Create: `README.md`
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create `README.md`**

````markdown
# JDM Experience

Event-company app (React Native attendee app + Next.js admin web + Fastify API).
Brazilian, PT-BR first, LGPD-aware.

## Prereqs

- Node 22 LTS (`nvm use` honors `.nvmrc`)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10.4.1 --activate`)
- Docker Desktop (for local Postgres)
- (Optional, for mobile) Xcode 16 + iOS Simulator, Android Studio with an AVD,
  EAS CLI (`pnpm dlx eas-cli login`)

## First run (under 30 minutes)

```bash
# 1. Clone + install
git clone git@github.com:leaopedro/jdm.git
cd jdm
pnpm install

# 2. Copy env files
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env
cp packages/db/.env.example packages/db/.env

# 3. Start Postgres + run migrations
docker compose up -d postgres
pnpm --filter @jdm/db db:migrate
pnpm --filter @jdm/db db:generate

# 4. Run everything
pnpm dev
```
````

After `pnpm dev`:

- API → http://localhost:4000/health
- Admin → http://localhost:3000
- Mobile → open the Expo Dev Tools QR, scan with Expo Go or a dev build.

## Running individual apps

```bash
pnpm --filter @jdm/api dev
pnpm --filter @jdm/admin dev
pnpm --filter @jdm/mobile start
```

## Tests

```bash
pnpm test                    # all workspaces
pnpm --filter @jdm/api test  # api only (spins up Postgres via Testcontainers)
```

Run a single test:

```bash
pnpm --filter @jdm/api exec vitest run test/health.test.ts -t "returns ok"
```

## Lint + typecheck + format

```bash
pnpm lint
pnpm typecheck
pnpm format         # write
pnpm format:check   # verify
```

## Deploying

- **API** → push to `main` → Railway auto-deploys. See `RAILWAY.md`.
- **Admin** → push to `main` → Vercel auto-deploys. See `docs/vercel.md`.
- **Mobile** → `eas build --profile preview --platform ios|android`. See
  `docs/eas-credentials.md`.

## Repo layout

```
apps/api      Fastify + Prisma REST API
apps/admin    Next.js organizer web app
apps/mobile   Expo attendee app (React Native)
packages/shared    Zod schemas shared across apps
packages/db        Prisma schema + client singleton
packages/tsconfig  Shared tsconfig bases
```

## Planning docs

High-level product and architecture decisions live in two **local-only**
documents maintained by the team lead: `brainstorm.md` (architecture brief,
feature map F1–F12) and `roadmap.md` (ordered task list per phase). They are
listed in `.git/info/exclude` and are never committed.

## Support

- Bugs: GitHub Issues in this repo.
- Internal channels: see `docs/secrets.md` for where each external service
  lives.

````

- [ ] **Step 2: Create `CONTRIBUTING.md`**

```markdown
# Contributing

## Branching

- Branch off `main`. Use Conventional Commit prefixes for branch names too:
  `feat/ticketing-stripe`, `fix/auth-refresh-rotation`, etc.
- Keep PRs small. One task from `roadmap.md` ≈ one PR.

## Commits

Conventional Commits only:
- `feat:` user-visible feature
- `fix:` bug fix
- `chore:` tooling, deps, config
- `docs:` docs only
- `test:` tests only
- `ci:` CI configuration
- `refactor:` no behavior change
- Scope optional but preferred: `feat(api): ...`.

## Tests

- API changes require integration tests against a real Postgres (Testcontainers).
  No mocking the database.
- Shared helpers get unit tests.
- Mobile flows covered by Maestro in later phases — for Phase 0 a typecheck
  + a manual Expo run is enough.

## PR checklist

Before requesting review:

- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean
- [ ] Any new env var documented in `docs/secrets.md` + `.env.example`
- [ ] Any new secret registered in Railway / Vercel / EAS as appropriate
- [ ] Roadmap checkbox **not** ticked (only the merger ticks it post-deploy)

## Code style

- Strict TypeScript, no `any` unless justified with a comment.
- Zod at every system boundary (HTTP, webhooks, env parsing).
- Prefer pure functions; keep side effects at the edge (route handlers,
  service entrypoints).
- Never flip `Order.status` to `paid` outside a verified provider webhook.
- One Prisma migration per PR that touches the schema.

## Security

- Never commit secrets. `docs/secrets.md` is the source of truth for where
  each one lives.
- Webhook handlers must verify signatures and dedupe by provider event id.
- All mutations that touch other users' data require an authorization check
  — keep the "can X do Y to Z" predicate in a service, not the route.
````

- [ ] **Step 3: Verify lint/format accept the new docs**

```bash
pnpm format:check
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: add README and CONTRIBUTING for phase 0"
```

---

## Phase 0 exit criteria

All 16 tasks above are merged, deployed, and the following all return truthy from a fresh clone on a teammate's laptop:

- `pnpm install && pnpm dev` boots all three apps.
- `curl http://localhost:4000/health` returns `{"status":"ok",...}`.
- `curl http://localhost:3000/api/health` returns `{"status":"ok",...}`.
- Expo Dev Tools loads on iOS Simulator and an Android emulator, showing "OK · sha … · up …s" on the home screen.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all exit 0.
- Latest PR on GitHub shows green CI + Railway preview + Vercel preview URLs.
- Deliberate error at `/debug/boom` on prod Railway appears in Sentry `jdm-api`.
- `docs/secrets.md` lists every secret in use; `docs/eas-credentials.md` and `RAILWAY.md` and `docs/vercel.md` describe how each deploy target is wired.

Only after all of the above: tick `Phase 0 — Foundations` items 0.1–0.16 in `roadmap.md`. No other edits to `roadmap.md` are permitted.
