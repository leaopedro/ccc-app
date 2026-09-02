/**
 * Erros de dominio das acoes de billing.
 *
 * Os servicos em addons.ts e subscription-actions.ts nao conhecem Fastify e nao
 * podem responder HTTP. Eles lancam BillingActionError com um codigo estavel; as
 * rotas traduzem esse codigo para o corpo de resposta que cada superficie ja
 * contratou. Isso e o que permite a rota do membro manter EXATAMENTE os codigos e
 * mensagens que ela ja retornava antes da extracao, enquanto a rota admin usa os
 * seus proprios.
 */

export type BillingActionCode =
  | 'MembershipNotFound'
  | 'ModuleNotFound'
  | 'AddonAlreadyAttached'
  | 'AddonNotAttached'
  | 'InvalidStatus'
  | 'ProviderNotMutable'
  | 'NoChange'
  | 'PlanPriceMissing'
  | 'AmbiguousPlanItem'
  | 'GarageAlreadyPremium'
  | 'SubscriptionBelongsToAnotherGarage';

const HTTP_STATUS: Record<BillingActionCode, number> = {
  MembershipNotFound: 404,
  ModuleNotFound: 404,
  AddonNotAttached: 404,
  AddonAlreadyAttached: 409,
  InvalidStatus: 409,
  ProviderNotMutable: 409,
  NoChange: 409,
  AmbiguousPlanItem: 409,
  PlanPriceMissing: 422,
  GarageAlreadyPremium: 409,
  SubscriptionBelongsToAnotherGarage: 409,
};

export class BillingActionError extends Error {
  readonly code: BillingActionCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: BillingActionCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'BillingActionError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.detail = detail;
  }
}

export const isBillingActionError = (err: unknown): err is BillingActionError =>
  err instanceof BillingActionError;
