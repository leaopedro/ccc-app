import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const here = path.dirname(fileURLToPath(import.meta.url));

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('jdm_test')
    .withUsername('jdm')
    .withPassword('jdm')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  const dbPackageDir = path.resolve(here, '../../../packages/db');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  return async () => {
    await container?.stop();
  };
}
