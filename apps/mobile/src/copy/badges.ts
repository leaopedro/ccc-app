// Conquistas (badges) UI copy. PT-BR is primary; EN is exported as a scaffold
// for future migration to a shared locale package (CLAUDE.md mandates an i18n
// scaffold from day one). Two-level shape so the eventual move is mechanical.
//
// Catalog keys are badge codes verbatim (EVT-001 ... JDM-003). Mobile UI
// consumers (chunk 17) look up `badgesCopy.badges.catalog[code]` and fall back
// to the raw code if a key is missing — but every code MUST have an entry here.

const ptBR = {
  badges: {
    categories: {
      eventos: 'Eventos',
      carros: 'Carros',
      comunidade: 'Comunidade',
      jdm: 'CCC',
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
    catalog: {
      'EVT-001': {
        title: 'Primeira Largada',
        description: 'Seu primeiro check-in confirmado em um encontro CCC.',
        criteria: 'Faça check-in em qualquer evento publicado.',
      },
      'EVT-002': {
        title: 'Sequência de Três',
        description: 'Três eventos consecutivos sem perder nenhum.',
        criteria: 'Faça check-in em três eventos seguidos por data.',
      },
      'EVT-003': {
        title: 'Veterano de Pista',
        description: 'Dez check-ins confirmados na sua trajetória CCC.',
        criteria: 'Acumule 10 check-ins em eventos publicados.',
      },
      'CAR-001': {
        title: 'Garagem Aberta',
        description: 'O primeiro carro estacionado na sua garagem.',
        criteria: 'Adicione um carro à sua garagem.',
      },
      'CAR-002': {
        title: 'Garagem Cheia',
        description: 'Cinco carros ou mais ocupando suas vagas.',
        criteria: 'Tenha 5 carros simultâneos na garagem.',
      },
      'CAR-003': {
        title: 'Curador CCC',
        description: 'Dez carros ou mais na coleção da sua garagem.',
        criteria: 'Tenha 10 carros simultâneos na garagem.',
      },
      'COM-001': {
        title: 'Primeira Postagem',
        description: 'Sua estreia no feed de um evento.',
        criteria: 'Publique uma postagem no feed.',
      },
      'COM-002': {
        title: 'Voz da Comunidade',
        description: 'Comentários ativos nas conversas dos encontros.',
        criteria: 'Acumule comentários publicados em postagens do feed.',
      },
      'COM-003': {
        title: 'Em Chamas',
        description: 'Postagens engajadas em sequência na comunidade.',
        criteria: 'Mantenha uma sequência de postagens com engajamento.',
      },
      'JDM-001': {
        title: 'Marco Fixado',
        description: 'Primeiro local fixado no seu mapa CCC.',
        criteria: 'Fixe um local no seu mapa pessoal.',
      },
      'JDM-002': {
        title: 'Itinerário CCC',
        description: 'Participação ativa na agenda nacional de eventos.',
        criteria: 'Compareça a múltiplos eventos pelo país.',
      },
      'JDM-003': {
        title: 'Fundador',
        description: 'Você entrou antes de a comunidade decolar.',
        criteria: 'Conta criada antes de 01/06/2026.',
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
      jdm: 'CCC',
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
    catalog: {
      'EVT-001': {
        title: 'First Lap',
        description: 'Your first confirmed check-in at a CCC meet.',
        criteria: 'Check in to any published event.',
      },
      'EVT-002': {
        title: 'Three in a Row',
        description: 'Three consecutive events without skipping.',
        criteria: 'Check in to three events in a row by date.',
      },
      'EVT-003': {
        title: 'Track Veteran',
        description: 'Ten confirmed check-ins on your CCC journey.',
        criteria: 'Accumulate 10 check-ins at published events.',
      },
      'CAR-001': {
        title: 'Garage Open',
        description: 'The first car parked in your garage.',
        criteria: 'Add one car to your garage.',
      },
      'CAR-002': {
        title: 'Garage Full',
        description: 'Five or more cars filling your spots.',
        criteria: 'Hold 5 cars simultaneously in your garage.',
      },
      'CAR-003': {
        title: 'CCC Curator',
        description: 'Ten or more cars in your garage collection.',
        criteria: 'Hold 10 cars simultaneously in your garage.',
      },
      'COM-001': {
        title: 'First Post',
        description: 'Your debut on an event feed.',
        criteria: 'Publish a post on any event feed.',
      },
      'COM-002': {
        title: 'Community Voice',
        description: 'Active comments in event conversations.',
        criteria: 'Accumulate comments published on feed posts.',
      },
      'COM-003': {
        title: 'On Fire',
        description: 'Engaged posts in a community streak.',
        criteria: 'Maintain a posting streak with engagement.',
      },
      'JDM-001': {
        title: 'Marker Pinned',
        description: 'First location pinned to your CCC map.',
        criteria: 'Pin a location on your personal map.',
      },
      'JDM-002': {
        title: 'CCC Itinerary',
        description: 'Active participation across the national event calendar.',
        criteria: 'Attend multiple events around the country.',
      },
      'JDM-003': {
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
