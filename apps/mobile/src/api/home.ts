// Conteúdo institucional da tela de Início.
//
// PÚBLICO, sem token: a Início é a primeira tela e roda antes do login.
// Endpoint: GET /api/home-content.

import { homeContentResponseSchema, type HomeContentResponse } from '@ccc/shared/home';
import type { z } from 'zod';

import { request } from '~/api/client';

const homeSchema = homeContentResponseSchema as z.ZodType<HomeContentResponse>;

export const getHomeContent = (): Promise<HomeContentResponse> =>
  request('/api/home-content', homeSchema);
