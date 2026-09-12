import { describe, expect, it, vi } from 'vitest';

// ../api/client imports react-native directly (for the x-ccc-platform
// header), whose Flow-flavored `import typeof` syntax vitest's SSR transform
// cannot parse. Mock it before importing.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

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

describe('getCartCheckoutErrorMessage', () => {
  const apiError = (code: string) =>
    new ApiError(409, 'request failed', { error: 'Conflict', code, message: 'falhou' });

  it('mostra copy propria para pedido pendente em vez do erro generico', async () => {
    const { getCartCheckoutErrorMessage } = await import('./error-message');
    expect(getCartCheckoutErrorMessage(apiError('PENDING_TICKET_ORDER_FOR_EVENT'))).toBe(
      'Você já tem um pedido de ingresso pendente para este evento. Conclua o pagamento ou aguarde expirar.',
    );
  });

  it('mantem a copy do item digital bloqueado no iOS', async () => {
    const { getCartCheckoutErrorMessage } = await import('./error-message');
    expect(getCartCheckoutErrorMessage(apiError('VIRTUAL_ITEM_IOS_BLOCKED'))).toBe(
      'Este item não pode ser comprado pelo aplicativo iOS. Remova-o do carrinho para continuar.',
    );
  });

  it('cai no erro de checkout, nao no de adicionar item, quando o codigo e desconhecido', async () => {
    const { getCartCheckoutErrorMessage } = await import('./error-message');
    expect(getCartCheckoutErrorMessage(new Error('boom'))).toBe('Erro ao iniciar o pagamento.');
  });
});
