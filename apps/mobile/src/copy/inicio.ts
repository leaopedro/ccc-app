// PT-BR copy da tela de Início (vitrine do usuário não logado).
// EN scaffold kept minimal per the i18n mandate (CLAUDE.md cross-cutting).
//
// Só rótulos de UI moram aqui. Título, subtítulo, texto institucional,
// benefícios e destaques vêm do banco via GET /api/home-content.

export const inicioCopy = {
  sections: {
    benefits: 'BENEFÍCIOS DA ASSINATURA',
    plans: 'CONHEÇA OS PLANOS',
    highlights: 'EVENTOS E EXPERIÊNCIAS',
    clubStats: 'STATUS DO CLUBE',
    store: 'NA LOJA',
    confirmedCars: 'QUEM JA CONFIRMOU',
    quickAccess: 'ACESSO RÁPIDO',
    myTickets: 'MEUS INGRESSOS',
    myGarage: 'MINHA GARAGEM',
    subscription: 'SUA ASSINATURA',
    box: 'CAIXA DO MÊS',
    nextEvent: 'PRÓXIMO EVENTO',
  },
  cta: {
    signup: 'CRIAR CONTA',
    signupHint: 'Leva menos de um minuto.',
    subscribe: 'QUERO ASSINAR',
    subscribeHint: 'Escolha o plano que combina com o seu jeito de dirigir.',
  },
  plans: {
    from: 'A PARTIR DE',
    perMonth: '/MÊS',
    seeAll: 'Ver todos os planos',
  },
  highlightKind: {
    event: 'EVENTO',
    day_use: 'DAY USE',
    experience: 'EXPERIÊNCIA',
    partner: 'PARCEIRO',
  },
  states: {
    errorTitle: 'Não foi possível carregar a tela inicial.',
    errorRetry: 'Tentar novamente',
  },
  clubStats: {
    members: 'MEMBROS',
    events: 'EVENTOS',
    garage: 'GARAGEM',
  },
  member: {
    greeting: (firstName: string) => `BEM-VINDO DE VOLTA, ${firstName.toUpperCase()}`,
    greetingFallback: 'BEM-VINDO DE VOLTA',
    memberSince: (monthYear: string) => `MEMBRO DESDE ${monthYear.toUpperCase()}`,
  },
  quickAccess: {
    events: 'Eventos',
    tickets: 'Ingressos',
    garage: 'Garagem',
    store: 'Loja',
  },
  cards: {
    seeEvent: 'VER EVENTO',
    seeAllStore: 'Ver a loja',
    seeGarage: 'Ver minha garagem',
    seeSubscription: 'Ver minha assinatura',
    subscribeUpsell: 'ASSINAR',
    seeBox: 'Ver a caixa',
    seeTickets: 'Ver todos',
  },
  empty: {
    noNextEvent: 'Nenhum evento agendado.',
    noTickets: 'Você ainda não tem ingressos.',
  },
} as const;
