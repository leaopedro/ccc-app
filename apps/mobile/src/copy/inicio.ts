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
    confirmedCars: 'QUEM JÁ CONFIRMOU',
    quickAccess: 'ACESSO RÁPIDO',
    myTickets: 'MEUS INGRESSOS',
    myGarage: 'MINHA GARAGEM',
    subscription: 'SUA ASSINATURA',
    box: 'CAIXA DO MÊS',
    nextEvent: 'PRÓXIMO EVENTO',
  },
  cta: {
    // GuestHome header's login entry point (fix round 1, Minor 3): the only
    // way back into the app for a returning member on the anonymous home,
    // so it lives here instead of as a literal in the component.
    login: 'ENTRAR',
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
  // Fix round 1 (ruling R3): linha de contagem de carros/vagas da
  // MyGarageSection. Vocabulário espelha `apps/mobile/src/copy/garage.ts`
  // (`carCountLabel`: carro/carros); não há pluralizador de vagas lá, então
  // seguimos o mesmo padrão singular/plural. Joiner (" · ") e ordem (carros
  // antes de vagas) ficam explícitos aqui, não montados ad-hoc no componente.
  garage: {
    counts: (cars: number, spots: number) =>
      `${cars} ${cars === 1 ? 'carro' : 'carros'} · ${spots} ${spots === 1 ? 'vaga' : 'vagas'}`,
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
