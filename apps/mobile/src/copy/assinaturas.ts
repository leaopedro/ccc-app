// PT-BR copy for the Assinaturas module (planos, detalhe, minha assinatura).
// EN scaffold kept minimal per the i18n mandate (CLAUDE.md cross-cutting).

export const assinaturasCopy = {
  header: {
    title: 'ASSINATURA',
    back: 'Voltar',
  },
  intro: {
    eyebrow: 'ESCOLHA SEU NÍVEL',
    heading: ['Torne-se membro', 'da Casa'],
    subcopy: 'Selecione o plano que combina com o seu jeito de dirigir, conectar e pertencer.',
  },
  plans: {
    perMonth: 'POR MÊS',
    // CTA label is "ASSINAR {TIER}" — tier appended by the screen.
    ctaPrefix: 'ASSINAR',
  },
  modules: {
    eyebrow: 'MÓDULOS ADICIONAIS',
    subcopy: 'Serviços extras opcionais que você pode adicionar à sua assinatura, agora ou depois.',
    perMonth: '/MÊS',
    footnote: 'Você poderá adicionar módulos durante a contratação ou depois, em Minha Assinatura.',
  },
  // Loading / error / empty shared across the planos + detalhe screens.
  states: {
    loading: 'Carregando planos...',
    errorTitle: 'Não foi possível carregar os planos.',
    errorRetry: 'Tentar novamente',
    empty: 'Nenhum plano disponível no momento.',
  },
  detail: {
    back: 'Voltar',
    header: 'PLANO',
    perMonth: 'POR MÊS',
    benefitsTitle: 'O QUE ESTÁ INCLUÍDO',
    cta: 'ASSINAR',
    notFound: 'Plano não encontrado.',
  },
  // Shared between ContratarScreen and PlanoDetalheScreen — not owned by
  // either, so it lives at the top level rather than under `contratar`.
  //
  // Decisão 6 — the physical side of the membership, stated before purchase.
  // The per-plan contents come from the DB benefit labels (registered by hand
  // in /premium/catalogo, prerequisite H3); this block is the framing that
  // makes them read as a physical delivery rather than an app feature.
  //
  // Fix round 1 (Criticals 1+2): the box is opt-in per cycle, curated and
  // confirmed by the member before a cutoff (`box-cutoff.ts`) — not something
  // that simply arrives. A box with no confirmation, no items, or no
  // auto-send address is skipped entirely (`box-cutoff.ts:137-143`), so this
  // copy must not promise automatic delivery. Freight is also never
  // mentioned: only one seeded region ships free (`seed.ts:694`), everywhere
  // else pays `shippingFeeCents`, and an unpaid-shipping box outside that
  // region is skipped rather than sent (`box-cutoff.ts:28-31`) — any single
  // blanket claim about freight is false somewhere, so the paywall makes none.
  caixa: {
    title: 'A CAIXA CASA CAR CLUB',
    body: 'Todo ciclo, você monta sua caixa com curadoria da Casa e confirma antes do fechamento.',
    delivery: 'Uma caixa por ciclo mensal, mediante sua confirmação.',
  },
  contratar: {
    header: 'CONTRATAR',
    back: 'Voltar',
    planLabel: 'PLANO ESCOLHIDO',
    modulesTitle: 'MÓDULOS ADICIONAIS',
    modulesSubcopy: 'Opcionais. Você pode adicionar ou remover depois.',
    add: 'ADICIONAR',
    remove: 'REMOVER',
    quotaAccess: (n: number) => `${n} acessos por mês`,
    quotaHours: (n: number) => `${n} horas por mês`,
    summaryBase: 'Mensalidade base',
    summaryModules: 'Módulos',
    summaryTotal: 'Total por mês',
    cta: 'IR PARA O PAGAMENTO',
    ctaLoading: 'PROCESSANDO...',
    confirming: 'Confirmando pagamento...',
    pendingTitle: 'Pagamento em processamento.',
    pendingSubcopy: 'Assim que o pagamento for confirmado sua assinatura aparece aqui.',
    pendingCta: 'VER MINHA ASSINATURA',
    successToast: 'Assinatura ativada.',
    errorGeneric: 'Não foi possível iniciar o pagamento. Tente novamente.',
    // One string per actionable failure. Telling a member to "tente novamente"
    // when the answer is "you already subscribe" or "wait a minute" sends them
    // into a retry loop that cannot succeed.
    errorUnavailable: 'A contratação está indisponível agora. Tente mais tarde.',
    errorAddon: 'Um dos módulos escolhidos está indisponível. Remova ele e tente de novo.',
    errorAlreadySubscribed: 'Você já tem uma assinatura ativa.',
    errorAlreadySubscribedCta: 'GERENCIAR ASSINATURA',
    errorStaleBilling: 'Seu cadastro de pagamento não é mais válido. Fale com a gente.',
    errorIncompleteProfile: 'Complete seu perfil antes de assinar.',
    errorRateLimited: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
    errorPlanNotFound: 'Esse plano não está mais disponível.',
    errorUnauthorized: 'Sua sessão expirou. Entre de novo para continuar.',
    errorAttemptInFlight:
      'Já existe uma tentativa de pagamento em andamento. Aguarde um instante e tente de novo.',
  },
  minhaAssinatura: {
    header: 'MINHA ASSINATURA',
    back: 'Voltar',
    loading: 'Carregando sua assinatura...',
    errorTitle: 'Não foi possível carregar sua assinatura.',
    errorRetry: 'Tentar novamente',
    planLabel: 'SEU PLANO',
    baseLabel: 'Mensalidade base',
    addonsLabel: 'Módulos adicionais',
    totalLabel: 'Total por mês',
    addonsTitle: 'MÓDULOS',
    usageLabel: 'Uso no ciclo',
    usageAccess: (used: number, total: number) => `${used} de ${total} acessos usados`,
    usageHours: (used: number, total: number) => `${used} de ${total} horas usadas`,
    usageRemainingAccess: (remaining: number) => `${remaining} restantes`,
    usageRemainingHours: (remaining: number) => `${remaining}h restantes`,
    usageNoCycle: 'Sem ciclo aberto.',
    addonStatusCancelScheduled: 'Cancelamento agendado',
    renewsAt: (date: string) => `Renova em ${date}`,
    cancelsAt: (date: string) => `Cancela em ${date}`,
    // No active membership.
    emptyTitle: 'Você ainda não é assinante.',
    emptySubcopy: 'Escolha um plano e faça parte da Casa.',
    emptyCta: 'VER PLANOS',
    // Billing switched off (flag / 503) — the screen cannot tell which. Not
    // "coming soon": the feature exists and "em breve" reads as it having
    // been withdrawn to a member who already pays. But the flag-off case is
    // a deliberate pre-launch rollout gate (see apps/api/src/env.ts), not a
    // malfunction, and its resolution is a multi-step smoke-test signoff,
    // not minutes — so this copy must not assert a cause ("manutenção") or a
    // timeline ("minutos") that only holds for the 503 case. State only.
    unavailableTitle: 'Assinaturas indisponíveis no momento.',
    unavailableSubcopy: 'Tente novamente mais tarde.',
    benefitsTitle: 'O QUE ESTÁ INCLUÍDO',
    seeAllPlans: 'VER TODOS OS PLANOS',
    historico: {
      title: 'HISTÓRICO DE COBRANÇAS',
      empty: 'Nenhuma cobrança ainda.',
      error: 'Não foi possível carregar o histórico.',
      refunded: 'Estornado',
      paidAt: (date: string) => `Pago em ${date}`,
    },
    cancelar: {
      trigger: 'Cancelar assinatura',
      sheetTitle: 'Cancelar assinatura',
      body: (date: string) =>
        `Sua assinatura continua ativa até ${date}. Depois dessa data você perde os benefícios e os módulos contratados.`,
      keep: 'MANTER ASSINATURA',
      confirm: 'CANCELAR ASSINATURA',
      loading: 'CANCELANDO...',
      successToast: 'Cancelamento agendado.',
      error: 'Não foi possível cancelar. Tente novamente.',
      appleTitle: 'Assinatura pela App Store',
      appleBody: 'Esta assinatura foi contratada pela App Store. O cancelamento é feito por lá.',
      appleCta: 'ABRIR APP STORE',
    },
  },
} as const;

/**
 * EN scaffold. This file was PT-only until 2026-08-29; only the keys added from
 * that date on carry an EN twin, so the eventual move to a shared locale package
 * is mechanical instead of a rewrite.
 */
export const assinaturasCopyEn = {
  // Mirrors the top-level `caixa` key in `assinaturasCopy` — keep both in
  // sync (fix round 1, Criticals 1+2: opt-in/curated per cycle, no freight
  // claim; see the comment on `assinaturasCopy.caixa` for why).
  caixa: {
    title: 'THE CASA CAR CLUB BOX',
    body: 'Every cycle, you curate your box and confirm it before the cutoff.',
    delivery: 'One box per monthly cycle, on your confirmation.',
  },
} as const;

export type AssinaturasCopy = typeof assinaturasCopy;
