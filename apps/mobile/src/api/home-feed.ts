import { type HomeFeedResponse, homeFeedResponseSchema } from '@ccc/shared/feed';

import { ApiError, authedRequest, request } from '~/api/client';

const PATH = '/api/home-feed';

/**
 * GET /api/home-feed.
 *
 * authedRequest com fallback anônimo, o mesmo idiom de listFeedPosts
 * (src/api/feed.ts:23-38). O token não é opcional aqui: `request` só manda
 * `authorization` se receber um token explícito (client.ts:34-41), e sem ele o
 * servidor trata todo mundo como anônimo — `blockedUserIdsFor(null)` devolve
 * [] e o membro que bloqueou um assediador continuaria vendo os posts dele na
 * primeira tela do app, com a suíte da API verde.
 *
 * O fallback existe porque o boot na web chega no feed antes do provider de
 * token subir.
 */
export const listHomeFeed = async (): Promise<HomeFeedResponse> => {
  try {
    return await authedRequest(PATH, homeFeedResponseSchema);
  } catch (error) {
    if (
      (error instanceof ApiError && error.status === 401) ||
      (error instanceof Error &&
        (error.message === 'token provider not registered' || error.message === 'no access token'))
    ) {
      return request(PATH, homeFeedResponseSchema);
    }
    throw error;
  }
};
