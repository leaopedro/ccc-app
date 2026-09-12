import type { Prisma, PrismaClient } from '@prisma/client';

// Chaves estáveis dos níveis. O NOME é editável pelo admin
// (GeneralSettings.rankNames), então nada pode encadear ou comparar por nome.
export const RANK_KEYS = [
  'iniciante',
  'pilotador',
  'veterano',
  'lendario',
  'hall_of_fame',
] as const;
export type RankKey = (typeof RANK_KEYS)[number];

// Tabela server-only. Os cortes continuam em código; só o nome sai daqui.
// Não reexporte esta tabela via `@ccc/shared`: `min`/`nextAt` são detalhe
// de servidor e não devem vazar para mobile/admin.
// A linha de topo NÃO tem `nextAt`: sem o campo, nenhuma leitura futura
// consegue tipar `null` como `number` no cálculo abaixo.
export const RANK_TIERS: { key: RankKey; name: string; min: number; nextAt?: number }[] = [
  { key: 'iniciante', name: 'Iniciante', min: 0, nextAt: 100 },
  { key: 'pilotador', name: 'Pilotador', min: 100, nextAt: 500 },
  { key: 'veterano', name: 'Veterano', min: 500, nextAt: 2000 },
  { key: 'lendario', name: 'Lendário', min: 2000, nextAt: 5000 },
  { key: 'hall_of_fame', name: 'Hall of Fame', min: 5000 },
];

// Era uma união literal derivada de RANK_TIERS[number]['name']. Com nome
// editável isso vira mentira, então alarga para string.
export type RankName = string;

/**
 * The derived progress shape sent on the wire to mobile + admin clients.
 * Field order matches the outline §"Rank derivation" excerpt so a future
 * `garageProgressSchema` (chunk 2A.24) can `z.object({ ... })` against
 * the same key set in the same order.
 */
export type GarageProgress = {
  xp: number;
  rank: RankName;
  nextRank: RankName | null;
  xpInTier: number;
  xpToNextRank: number;
  tierSpan: number;
};

export type RankNames = Partial<Record<RankKey, string>>;

// Either the global Prisma client or a transaction client. Callers
// already inside a `$transaction` MUST pass the tx client so the read
// participates in the surrounding snapshot. Same shape as canon §3 in
// `2026-05-24-phase2-fix-canon.md` (matches `getGarageStats` in chunk 25).
type ReadClient = PrismaClient | Prisma.TransactionClient;

// Parcial, não total: a resolução é `names[key] ?? nome de código`, e um
// Record total não teria chave ausente para cair no fallback.
const resolveName = (index: number, names: RankNames): string => {
  const tier = RANK_TIERS[index];
  if (!tier) return '';
  return names[tier.key] ?? tier.name;
};

/**
 * Pure rank-derivation over the `RANK_TIERS` table. No DB access.
 *
 *  - Picks the highest tier whose `min` is ≤ `xp`.
 *  - Top-tier guard (§C14): positional (index === RANK_TIERS.length - 1),
 *    returns `nextRank: null`, `xpToNextRank: 0`, and the `tierSpan = 1`
 *    sentinel so the UI can divide without dividing by zero.
 *  - Non-top tiers: `xpToNextRank = tier.nextAt - xp` (always ≥ 0
 *    because the iteration above already picked the matching tier),
 *    and `tierSpan = tier.nextAt - tier.min`.
 *
 * `xp` is treated as a non-negative integer (Garage.xp is `Int @default(0)`
 * and the awarder enforces non-negative writes — see chunk 27).
 */
export const deriveProgress = (xp: number, names: RankNames = {}): GarageProgress => {
  // Preserva o índice: o guard de topo é posicional agora.
  let index = 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    const row = RANK_TIERS[i];
    if (row !== undefined && xp >= row.min) {
      index = i;
      break;
    }
  }

  const tier = RANK_TIERS[index]!;

  // §C14: o topo sai antes de qualquer leitura de nextAt. Posicional, e não
  // `next === null`: derivar `next` da linha seguinte produz `undefined`, que
  // não é `null`, e o topo cairia no cálculo abaixo com nextAt indefinido,
  // gerando xpToNextRank negativo. garageProgressSchema recusa negativo, o
  // que vira 500 em GET /me/garage e GET /g/:slug.
  const atTop = index === RANK_TIERS.length - 1;
  if (atTop) {
    return {
      xp,
      rank: resolveName(index, names),
      nextRank: null,
      xpInTier: xp - tier.min,
      xpToNextRank: 0,
      tierSpan: 1,
    };
  }

  const nextAt = tier.nextAt as number;
  return {
    xp,
    rank: resolveName(index, names),
    nextRank: resolveName(index + 1, names),
    xpInTier: xp - tier.min,
    xpToNextRank: nextAt - xp,
    tierSpan: nextAt - tier.min,
  };
};

/**
 * DB-backed wrapper. Reads `Garage.xp` by primary key and derives the
 * progress shape. Throws Prisma's `P2025` (RecordNotFound) when the
 * garage row does not exist — same semantics as Prisma's
 * `findUniqueOrThrow`, so the caller can rely on a non-null result.
 *
 * Killswitch gating is NOT applied here — the chunk-2A.28 serializer
 * decides whether to include the resulting block on the wire. Keeping
 * this service unconditional means an admin-side debug surface can
 * always inspect a user's progress even when the public surface is off.
 */
export const getGarageProgress = async (
  client: ReadClient,
  garageId: string,
  names: RankNames = {},
): Promise<GarageProgress> => {
  const row = await client.garage.findUniqueOrThrow({
    where: { id: garageId },
    select: { xp: true },
  });
  return deriveProgress(row.xp, names);
};
