// packages/shared/src/club-stats.ts
// Contadores agregados do clube, exibidos na secao "Status do clube" da tela
// de Inicio. Backs GET /api/club-stats.
//
// Sao contagens do clube, nunca do membro: o mesmo payload serve o anonimo e o
// membro logado.

import { z } from 'zod';

export const clubStatsResponseSchema = z.object({
  /** Usuarios com status ativo. */
  members: z.number().int().nonnegative(),
  /** Eventos publicados com inicio no futuro. */
  events: z.number().int().nonnegative(),
  /** Carros cadastrados em garagens. */
  cars: z.number().int().nonnegative(),
});

export type ClubStatsResponse = z.infer<typeof clubStatsResponseSchema>;
