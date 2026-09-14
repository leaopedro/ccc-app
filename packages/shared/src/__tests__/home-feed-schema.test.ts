import { describe, expect, it } from 'vitest';

import {
  FEED_PUBLIC_RESPONSE_SCHEMAS,
  HOME_FEED_POOL_SIZE,
  homeFeedItemSchema,
  homeFeedResponseSchema,
} from '../feed.js';

const item = {
  id: 'p1',
  eventId: 'e1',
  car: null,
  body: 'texto',
  status: 'visible' as const,
  photos: [],
  reactions: { likes: 0, mine: false },
  commentCount: 0,
  isOwn: false,
  createdAt: '2026-09-13T12:00:00.000Z',
  updatedAt: '2026-09-13T12:00:00.000Z',
  event: { slug: 'encontro-setembro', title: 'Encontro de Setembro' },
};

describe('home feed schemas', () => {
  it('aceita um item com o evento embutido', () => {
    expect(() => homeFeedItemSchema.parse(item)).not.toThrow();
  });

  it('recusa um item sem o evento', () => {
    const { event: _event, ...withoutEvent } = item;
    expect(() => homeFeedItemSchema.parse(withoutEvent)).toThrow();
  });

  it('descarta authorUserId em vez de propagar', () => {
    const parsed = homeFeedItemSchema.parse({ ...item, authorUserId: 'u1' });
    expect(parsed).not.toHaveProperty('authorUserId');
  });

  it('envelopa a lista', () => {
    expect(homeFeedResponseSchema.parse({ posts: [item] }).posts).toHaveLength(1);
  });

  it('expoe o tamanho do pool sorteado', () => {
    expect(HOME_FEED_POOL_SIZE).toBe(50);
  });

  it('entra no contrato de privacidade', () => {
    expect(FEED_PUBLIC_RESPONSE_SCHEMAS).toHaveProperty('homeFeedItem');
    expect(FEED_PUBLIC_RESPONSE_SCHEMAS).toHaveProperty('homeFeedResponse');
  });
});
