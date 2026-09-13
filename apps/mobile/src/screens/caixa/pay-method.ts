// Decisao pura sobre a disponibilidade do cartao na caixa. Separada da tela
// para ser testavel sem renderizar.

/**
 * A caixa nao tem hosted checkout: sem PaymentSheet nao ha cobranca no cartao.
 * Logo, no web ou num build sem chave publicavel, o cartao nao e oferecido e o
 * Pix segue como unico caminho.
 */
export const cardAvailable = (args: {
  isWeb: boolean;
  publishableKey: string | undefined;
}): boolean => !args.isWeb && !!args.publishableKey;
