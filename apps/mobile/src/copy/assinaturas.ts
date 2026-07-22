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
  // Contratação stub — real checkout is P5 (see screens/assinaturas/checkout.ts).
  checkout: {
    comingSoon: 'Contratação em breve.',
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
  },
} as const;

export type AssinaturasCopy = typeof assinaturasCopy;
