// Conquistas (badges) UI copy. PT-BR is primary; EN is exported as a scaffold
// for future migration to a shared locale package (CLAUDE.md mandates an i18n
// scaffold from day one). Two-level shape so the eventual move is mechanical.
//
// Este arquivo é FALLBACK, não fonte de verdade. O texto autoritativo vive em
// `Badge.title` / `Badge.description` / `Badge.criteria` no banco, editável em
// /configuracoes/conquistas, e chega ao app pelo catálogo da API. O bundle
// cobre o caso de um app novo contra uma API velha, que não manda esses campos.
//
// `criteria` é a regra REAL de `apps/api/src/services/garage/eligibility/*`.
// Se a regra mudar lá, o texto muda aqui e na migration de seed. Um critério
// que não corresponde ao código é pior que critério nenhum: promete e não
// entrega.
//
// COM-002 e COM-003 foram removidas: nenhuma regra jamais as concedeu. Os
// códigos não serão reaproveitados.

const ptBR = {
  badges: {
    categories: {
      eventos: 'Eventos',
      carros: 'Carros',
      comunidade: 'Comunidade',
      ccc: 'CCC',
    },
    rarities: {
      common: 'Comum',
      rare: 'Raro',
      legendary: 'Lendário',
    },
    lockedLabel: 'Bloqueado',
    lockedPremiumLabel: 'Exclusivo Premium',
    earnedAtPrefix: 'Conquistada em',
    pinAction: 'Fixar',
    unpinAction: 'Desafixar',
    emptyTitle: 'Sem conquistas ainda',
    emptyBody: 'Participe dos encontros e adicione carros para começar a colecionar.',
    celebration: {
      titleOne: 'NOVA CONQUISTA!',
      titleMany: (count: number) => `VOCÊ GANHOU ${count} CONQUISTAS`,
      close: 'Fechar',
      more: (count: number) => `+${count}`,
    },
    catalog: {
      'EVT-001': {
        title: 'Primeira Largada',
        description: 'Seu primeiro check-in confirmado em um encontro CCC.',
        criteria: 'Faça check-in em qualquer evento.',
      },
      'EVT-002': {
        title: 'Sequência de Três',
        description: 'Três eventos consecutivos sem perder nenhum.',
        criteria:
          'Faça check-in nos três últimos eventos para os quais você tem ingresso, sem faltar a nenhum.',
      },
      'EVT-003': {
        title: 'Veterano de Pista',
        description: 'Dez eventos CCC na sua trajetória.',
        criteria: 'Faça check-in em 10 eventos diferentes.',
      },
      'EVT-004': {
        title: 'Maratona',
        description: 'Três encontros em trinta dias.',
        criteria: 'Faça check-in em 3 eventos diferentes num intervalo de 30 dias.',
      },
      'EVT-005': {
        title: 'Fiel de Carteirinha',
        description: 'Vinte e cinco encontros CCC no seu histórico.',
        criteria: 'Faça check-in em 25 eventos diferentes.',
      },
      'CAR-001': {
        title: 'Garagem Aberta',
        description: 'O primeiro carro estacionado na sua garagem.',
        criteria: 'Adicione um carro à sua garagem.',
      },
      'CAR-002': {
        title: 'Garagem Cheia',
        description: 'Todas as suas vagas gratuitas ocupadas.',
        criteria: 'Preencha com carros todas as vagas gratuitas da sua garagem.',
      },
      'CAR-003': {
        title: 'Curador CCC',
        description: 'Cinco carros na coleção da sua garagem.',
        criteria: 'Tenha 5 carros na garagem ao mesmo tempo.',
      },
      'COM-001': {
        title: 'Primeira Postagem',
        description: 'Sua estreia no feed de um evento.',
        criteria: 'Publique uma postagem no feed.',
      },
      'COM-008': {
        title: 'Fotógrafo do Rolê',
        description: 'Vinte fotos suas no feed dos encontros.',
        criteria: 'Publique 20 fotos em postagens do feed.',
      },
      'CCC-001': {
        title: 'Curitibano de Coração',
        description: 'Presença confirmada num encontro em Curitiba.',
        criteria: 'Faça check-in em um evento realizado em Curitiba.',
      },
      'CCC-002': {
        title: 'Drift King',
        description: 'Presença confirmada num evento de drift.',
        criteria: 'Faça check-in em um evento do tipo drift.',
      },
      'CCC-003': {
        title: 'Fundador',
        description: 'Você entrou antes de a comunidade decolar.',
        criteria: 'Ter criado a conta antes de 01/06/2026.',
      },
    },
  },
} as const;

const en = {
  badges: {
    categories: {
      eventos: 'Events',
      carros: 'Cars',
      comunidade: 'Community',
      ccc: 'CCC',
    },
    rarities: {
      common: 'Common',
      rare: 'Rare',
      legendary: 'Legendary',
    },
    lockedLabel: 'Locked',
    lockedPremiumLabel: 'Premium Exclusive',
    earnedAtPrefix: 'Earned on',
    pinAction: 'Pin',
    unpinAction: 'Unpin',
    emptyTitle: 'No badges yet',
    emptyBody: 'Attend meets and add cars to start collecting.',
    celebration: {
      titleOne: 'NEW BADGE!',
      titleMany: (count: number) => `YOU EARNED ${count} BADGES`,
      close: 'Close',
      more: (count: number) => `+${count}`,
    },
    catalog: {
      'EVT-001': {
        title: 'First Lap',
        description: 'Your first confirmed check-in at a CCC meet.',
        criteria: 'Check in to any event.',
      },
      'EVT-002': {
        title: 'Three in a Row',
        description: 'Three consecutive events without skipping.',
        criteria: 'Check in to the last three events you hold a ticket for, missing none.',
      },
      'EVT-003': {
        title: 'Track Veteran',
        description: 'Ten CCC events on your journey.',
        criteria: 'Check in to 10 different events.',
      },
      'EVT-004': {
        title: 'Marathon',
        description: 'Three meets in thirty days.',
        criteria: 'Check in to 3 different events within 30 days.',
      },
      'EVT-005': {
        title: 'Card-Carrying Regular',
        description: 'Twenty-five CCC meets in your history.',
        criteria: 'Check in to 25 different events.',
      },
      'CAR-001': {
        title: 'Garage Open',
        description: 'The first car parked in your garage.',
        criteria: 'Add a car to your garage.',
      },
      'CAR-002': {
        title: 'Garage Full',
        description: 'Every free spot of yours taken.',
        criteria: 'Fill every free spot in your garage with a car.',
      },
      'CAR-003': {
        title: 'CCC Curator',
        description: 'Five cars in your garage collection.',
        criteria: 'Keep 5 cars in the garage at the same time.',
      },
      'COM-001': {
        title: 'First Post',
        description: 'Your debut on an event feed.',
        criteria: 'Publish a post on the feed.',
      },
      'COM-008': {
        title: 'Meet Photographer',
        description: 'Twenty photos of yours on the meet feeds.',
        criteria: 'Publish 20 photos in feed posts.',
      },
      'CCC-001': {
        title: 'Curitiba at Heart',
        description: 'Attendance confirmed at a meet in Curitiba.',
        criteria: 'Check in to an event held in Curitiba.',
      },
      'CCC-002': {
        title: 'Drift King',
        description: 'Attendance confirmed at a drift event.',
        criteria: 'Check in to a drift-type event.',
      },
      'CCC-003': {
        title: 'Founder',
        description: 'You joined before the community took off.',
        criteria: 'Account created before 2026-06-01.',
      },
    },
  },
} as const;

export const badgesCopy = ptBR;
export const badgesCopyEn = en;
export type BadgesCopy = typeof ptBR;
