import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { ApiError } = await import('../api/client');
const { getCartAddErrorMessage } = await import('./error-message');

describe('getCartAddErrorMessage', () => {
  it('translates MAX_TICKETS_EXCEEDED with parsed limit', () => {
    const err = new ApiError(409, 'request failed', {
      error: 'SoldOut',
      code: 'MAX_TICKETS_EXCEEDED',
      message: 'Exceeds max 4 ticket(s) per user for this event',
    });
    expect(getCartAddErrorMessage(err)).toBe(
      'Você já atingiu o limite de 4 ingressos por pessoa neste evento.',
    );
  });

  it('uses singular form when limit is 1', () => {
    const err = new ApiError(409, 'request failed', {
      error: 'SoldOut',
      code: 'MAX_TICKETS_EXCEEDED',
      message: 'Exceeds max 1 ticket(s) per user for this event',
    });
    expect(getCartAddErrorMessage(err)).toBe(
      'Você já atingiu o limite de 1 ingresso por pessoa neste evento.',
    );
  });

  it('translates TIER_SOLD_OUT', () => {
    const err = new ApiError(409, 'request failed', {
      error: 'SoldOut',
      code: 'TIER_SOLD_OUT',
      message: 'Only 0 ticket(s) remaining',
    });
    expect(getCartAddErrorMessage(err)).toBe('Ingresso esgotado.');
  });

  it('falls back to API message when code unknown', () => {
    const err = new ApiError(404, 'request failed', {
      error: 'NotFound',
      code: 'EVENT_NOT_FOUND',
      message: 'Event not found or not published',
    });
    expect(getCartAddErrorMessage(err)).toBe('Event not found or not published');
  });

  it('falls back to generic copy on non-ApiError', () => {
    expect(getCartAddErrorMessage(new Error('boom'))).toBe('Erro ao adicionar item ao carrinho.');
  });
});
