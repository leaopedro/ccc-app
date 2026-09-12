// Schemas do admin para a copy de gamificação. As chaves de nível são
// redeclaradas aqui porque apps/api/.../progress.ts é server-only e não pode
// ser importado pelo admin; um teste em apps/api amarra as duas listas.

import { z } from 'zod';

import { badgeCodeSchema } from './badges.js';

export const RANK_KEYS = [
  'iniciante',
  'pilotador',
  'veterano',
  'lendario',
  'hall_of_fame',
] as const;
export type RankKey = (typeof RANK_KEYS)[number];

/**
 * Caps vindos do que renderiza, não da coluna. BadgeDetail centraliza o título
 * em fontSize 22 sem maxWidth nem numberOfLines, e a pílula de nível em
 * XPScoreboard é fontSize 10 uppercase com letterSpacing 1.6 numa row sem
 * flexShrink. Os títulos atuais têm no máximo 18 caracteres e o maior nome de
 * nível tem 12, então os caps são folgados. As colunas seguem em 80 e 240.
 */
export const BADGE_TITLE_MAX = 40;
export const BADGE_DESCRIPTION_MAX = 240;
export const RANK_NAME_MAX = 20;

/** Quantas conquistas o catálogo tem. Um PUT maior que isto é recusado. */
export const BADGE_COPY_MAX_ENTRIES = 12;

// z.object com as cinco chaves obrigatórias, não z.record: em Zod 3 um
// z.record(z.enum(...)) tipa a saída como Record completo mas não valida
// exaustividade em runtime.
export const rankNamesSchema = z.object({
  iniciante: z.string().trim().min(1).max(RANK_NAME_MAX),
  pilotador: z.string().trim().min(1).max(RANK_NAME_MAX),
  veterano: z.string().trim().min(1).max(RANK_NAME_MAX),
  lendario: z.string().trim().min(1).max(RANK_NAME_MAX),
  hall_of_fame: z.string().trim().min(1).max(RANK_NAME_MAX),
});
export type RankNamesInput = z.infer<typeof rankNamesSchema>;

// Leitura: rankNames é JSONB, sem largura de coluna para espelhar como no
// badge. Mesmo assim mantém um teto frouxo, e não ilimitado, pelo mesmo
// motivo: um nome gravado por fora do admin (SQL direto) mais longo que
// RANK_NAME_MAX não pode fazer o GET (e por tabela o PUT) devolver 400 e
// travar a tela inteira.
export const rankNamesReadSchema = z.object({
  iniciante: z.string().min(1).max(200),
  pilotador: z.string().min(1).max(200),
  veterano: z.string().min(1).max(200),
  lendario: z.string().min(1).max(200),
  hall_of_fame: z.string().min(1).max(200),
});

// Escrita: capada no que renderiza.
export const badgeCopyEntrySchema = z.object({
  code: badgeCodeSchema,
  title: z.string().trim().min(1).max(BADGE_TITLE_MAX),
  description: z.string().trim().min(1).max(BADGE_DESCRIPTION_MAX),
});

// Leitura: capada no que a COLUNA aceita, não no cap de escrita. Um título de
// 60 caracteres gravado por SQL direto cabe na coluna (VarChar(80)) e faria o
// GET estourar se reusasse o cap de 40, transformando um dado estranho num 500.
export const badgeCopyReadEntrySchema = z.object({
  code: badgeCodeSchema,
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(BADGE_DESCRIPTION_MAX),
});

export const adminGamificationCopySchema = z.object({
  version: z.number().int().nonnegative(),
  badges: z.array(badgeCopyReadEntrySchema),
  rankNames: rankNamesReadSchema,
});
export type AdminGamificationCopy = z.infer<typeof adminGamificationCopySchema>;

export const gamificationCopyUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  badges: z.array(badgeCopyEntrySchema).max(BADGE_COPY_MAX_ENTRIES).optional(),
  rankNames: rankNamesSchema.optional(),
});
export type GamificationCopyUpdate = z.infer<typeof gamificationCopyUpdateSchema>;
