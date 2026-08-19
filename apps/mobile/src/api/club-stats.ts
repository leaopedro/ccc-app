// Contadores agregados do clube, para a secao "Status do clube" da Inicio.
//
// PUBLICO, sem token: a secao aparece nos dois estados da home.
// Endpoint: GET /api/club-stats.

import { clubStatsResponseSchema, type ClubStatsResponse } from '@ccc/shared/club-stats';
import type { z } from 'zod';

import { request } from '~/api/client';

const clubStatsSchema = clubStatsResponseSchema as z.ZodType<ClubStatsResponse>;

export const getClubStats = (): Promise<ClubStatsResponse> =>
  request('/api/club-stats', clubStatsSchema);
