import { describe, expect, it } from 'vitest';

import { cardAvailable } from '../pay-method';

describe('cardAvailable', () => {
  it('libera o cartao no nativo com chave publicavel', () => {
    expect(cardAvailable({ isWeb: false, publishableKey: 'pk_live_1' })).toBe(true);
  });

  it('esconde o cartao no web', () => {
    // A caixa nao tem hosted checkout: sem PaymentSheet nao ha como cobrar no
    // cartao, entao a opcao nao pode aparecer.
    expect(cardAvailable({ isWeb: true, publishableKey: 'pk_live_1' })).toBe(false);
  });

  it('esconde o cartao sem chave publicavel', () => {
    expect(cardAvailable({ isWeb: false, publishableKey: undefined })).toBe(false);
    expect(cardAvailable({ isWeb: false, publishableKey: '' })).toBe(false);
  });
});
