/**
 * gamification-copy admin — texto das conquistas e nomes de nível.
 *
 *   GET /admin/gamification/copy
 *   PUT /admin/gamification/copy
 *
 * requireRole('admin'), e não organizer como general-settings: o título da
 * conquista vira o corpo da notificação que o grant manual
 * (admin/user-garage.ts:397, organizer, 30/min) manda para um usuário
 * escolhido. O canal deliberado de organizer para usuário é o broadcast,
 * limitado a 5 por 15 minutos. Deixar copy em organizer abriria um caminho
 * direcionado e 360x mais frouxo.
 */

import { prisma } from '@ccc/db';
import {
  RANK_KEYS,
  type RankKey,
  adminGamificationCopySchema,
  gamificationCopyUpdateSchema,
} from '@ccc/shared/admin-gamification';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { RANK_TIERS } from '../../services/garage/progress.js';
import { ensureGeneralSettings } from '../../services/general-settings.js';
import { invalidateBadgesCatalogCache } from '../badges-catalog.js';

const codeName = (key: RankKey): string => RANK_TIERS.find((t) => t.key === key)?.name ?? key;

// Resolução única do nome efetivo de cada nível: `stored[key]` se for uma
// string não vazia, senão o nome de código. GET e o detector de mudança do
// PUT precisam concordar nisso — antes cada um tinha sua própria cópia da
// mesma ternária, e o PUT comparava o valor CRU (undefined numa linha nova)
// contra o valor que o GET já tinha defaultado, marcando `rankNames` como
// alterado em todo PUT que só ecoa de volta o que o GET acabou de mandar.
const resolveRankNames = (stored: Record<string, unknown>): Record<RankKey, string> =>
  Object.fromEntries(
    RANK_KEYS.map((key) => [
      key,
      typeof stored[key] === 'string' && stored[key] !== ''
        ? (stored[key] as string)
        : codeName(key),
    ]),
  ) as Record<RankKey, string>;

export const adminGamificationCopyRoutes: FastifyPluginAsync = async (app) => {
  const readCopy = async () => {
    // ensureGeneralSettings, não findUnique: a linha pode não existir (é por
    // isso que readGamificationEnabled faz `?? true`). Sem criar aqui, o
    // primeiro PUT num banco limpo daria 409 para sempre, porque o updateMany
    // não casaria nenhuma linha.
    const settings = await ensureGeneralSettings();
    const badges = await prisma.badge.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, title: true, description: true },
    });

    const stored = (settings.rankNames ?? {}) as Record<string, unknown>;
    const rankNames = resolveRankNames(stored);

    return adminGamificationCopySchema.parse({
      version: settings.gamificationCopyVersion,
      badges,
      rankNames,
    });
  };

  app.get('/gamification/copy', async () => readCopy());

  app.put('/gamification/copy', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = gamificationCopyUpdateSchema.parse(request.body);
    const incoming = input.badges ?? [];

    const seen = new Set<string>();
    for (const entry of incoming) {
      if (seen.has(entry.code)) {
        return reply.status(400).send({ error: 'duplicate_code', code: entry.code });
      }
      seen.add(entry.code);
    }

    const existingBadges = await prisma.badge.findMany({
      select: { code: true, title: true, description: true },
    });
    const byCode = new Map(existingBadges.map((b) => [b.code, b]));
    for (const entry of incoming) {
      if (!byCode.has(entry.code)) {
        return reply.status(400).send({ error: 'unknown_badge', code: entry.code });
      }
    }

    const settings = await ensureGeneralSettings();

    const touched: string[] = [];
    const badgeWrites: typeof incoming = [];
    for (const entry of incoming) {
      const current = byCode.get(entry.code)!;
      const titleChanged = current.title !== entry.title;
      const descChanged = current.description !== entry.description;
      if (titleChanged) touched.push(`badge.${entry.code}.title`);
      if (descChanged) touched.push(`badge.${entry.code}.description`);
      if (titleChanged || descChanged) badgeWrites.push(entry);
    }

    // Compara contra o nome EFETIVO (mesma resolução do GET), não contra o
    // valor cru da coluna: numa linha nova a coluna é NULL, então o valor cru
    // é `undefined` para toda chave, e comparar isso com o que o admin acabou
    // de receber do GET (já com o default aplicado) marcaria `rankNames` como
    // alterado em todo PUT que só ecoa de volta o que leu.
    const rankNamesInput = input.rankNames;
    const storedRanks = (settings.rankNames ?? {}) as Record<string, unknown>;
    const effectiveRanks = resolveRankNames(storedRanks);
    const ranksChanged =
      rankNamesInput !== undefined &&
      RANK_KEYS.some((key) => effectiveRanks[key] !== rankNamesInput[key]);
    if (ranksChanged) touched.push('rankNames');

    if (touched.length === 0) {
      return readCopy();
    }

    // Calculado fora da transação: com `rankNamesInput` checado aqui, o
    // narrowing do TS já garante non-undefined dentro do objeto, sem precisar
    // de `!` no data da transação.
    const rankUpdate =
      ranksChanged && rankNamesInput !== undefined ? { rankNames: rankNamesInput } : {};

    // A precondição É a escrita. Ler a versão, comparar em JS e depois gravar
    // perde update mesmo dentro de $transaction: o default é Read Committed e
    // um SELECT não trava linha, então dois admins que leem a versão 5 passam
    // os dois no teste e gravam os dois. Este updateMany é a primeira operação
    // da transação, e a linha de GeneralSettings serializa os concorrentes.
    let stale = false;
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.generalSettings.updateMany({
        where: {
          id: GENERAL_SETTINGS_SINGLETON_ID,
          gamificationCopyVersion: input.expectedVersion,
        },
        data: {
          gamificationCopyVersion: { increment: 1 },
          ...rankUpdate,
        },
      });
      if (count !== 1) {
        stale = true;
        return;
      }

      for (const entry of badgeWrites) {
        await tx.badge.update({
          where: { code: entry.code },
          data: { title: entry.title, description: entry.description },
        });
      }

      await recordAudit(
        {
          actorId: sub,
          action: 'gamification_copy.update',
          entityType: 'gamification_copy',
          entityId: GENERAL_SETTINGS_SINGLETON_ID,
          metadata: { fields: touched },
        },
        tx,
      );
    });

    if (stale) {
      return reply.status(409).send({ error: 'stale_write' });
    }

    // DEPOIS do commit. Dentro da transação, uma leitura concorrente
    // repopularia `cached` com linhas pré-commit e fixaria texto velho pelo
    // TTL inteiro, pior que não invalidar.
    invalidateBadgesCatalogCache();

    return readCopy();
  });
};
