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
    iosTitle: 'Contratação pelo site.',
    iosSubcopy: 'No iPhone a contratação é feita pelo site da Casa Car Club.',
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
    // Billing switched off (flag / 503).
    unavailableTitle: 'Assinaturas em breve.',
    unavailableSubcopy: 'A contratação de planos ainda não está disponível. Volte em breve.',
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

export type AssinaturasCopy = typeof assinaturasCopy;
