// PT-BR copy for the Assinaturas module ("Planos disponíveis" screen).
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
} as const;

export type AssinaturasCopy = typeof assinaturasCopy;
