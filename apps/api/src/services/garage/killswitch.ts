import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { Prisma } from '@prisma/client';

// Re-export so callers (and especially test fixtures, per canon §8) can pull
// the singleton id alongside `readGamificationEnabled` from one barrel — the
// XP awarder + its tests live in the same garage namespace and shouldn't need
// the shared-package path just to upsert the killswitch row.
export { GENERAL_SETTINGS_SINGLETON_ID };

// Either the global prisma client or a transaction client. Callers inside a
// `$transaction` MUST pass the tx client so the killswitch read participates
// in the surrounding snapshot — otherwise a Serializable tx would observe a
// different snapshot for the killswitch than for the writes it gates.
type ReadClient = Pick<typeof prisma, 'generalSettings'> | Prisma.TransactionClient;

/**
 * Synchronous per-request read of the Conquistas killswitch. Never cached:
 * admin toggles must propagate in < 1s per kickoff lock. The catalog cache
 * lives elsewhere (badges-catalog.ts) — it caches the row list, NOT the flag.
 *
 * Defaults to `true` when no `GeneralSettings` row exists yet. The DB column
 * defaults to `true` too; the fallback here matches the unseeded state used
 * by some test paths.
 *
 * Pass `client` (a `tx` from `prisma.$transaction`) when the read needs to
 * be inside an active transaction (awarder write-path hooks). Route handlers
 * that read the flag outside any tx can omit the argument.
 */
export const readGamificationEnabled = async (client: ReadClient = prisma): Promise<boolean> => {
  const row = await client.generalSettings.findUnique({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    select: { gamificationEnabled: true },
  });
  return row?.gamificationEnabled ?? true;
};
