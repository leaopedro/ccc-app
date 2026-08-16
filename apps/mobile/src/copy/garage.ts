// Garage UI copy. PT-BR is primary; EN is exported as a scaffold for future
// migration to a shared locale package (CLAUDE.md mandates an i18n scaffold
// from day one). Two-level shape so the eventual move is mechanical.

import { brand } from '@ccc/design';

const ptBR = {
  garage: {
    listTitle: 'Garagem',

    buySpotFailed: 'Não foi possível adicionar a vaga ao carrinho. Tente novamente.',

    // Inline edit affordances (per pivot spec §4.1 PATCH /me/garage).
    editName: 'Nome da garagem',
    editSlug: 'URL pública (/g/)',
    editDescription: 'Descrição',
    descriptionPlaceholder: 'Conte sobre sua garagem (opcional)',
    visibilityTitle: 'Visibilidade',
    visibilityPublicLabel: 'Tornar pública',
    visibilityPublicHint: 'Sua garagem fica visível em /g/<slug>.',
    visibilityPrivateHint: 'Apenas você vê esta garagem.',
    shareLink: 'Compartilhar link',
    shareLinkDisabledHint: 'Ative a visibilidade pública para compartilhar.',
    saveSuccess: 'Garagem atualizada.',
    saveFailed: 'Não foi possível atualizar a garagem.',
    slugTaken: 'Esta URL já está em uso. Escolha outra.',
    reservedSlug: 'Esta URL não está disponível. Escolha outra.',
    nameTooLong: 'O nome precisa ter entre 1 e 50 caracteres.',
    descriptionTooLong: 'A descrição pode ter no máximo 500 caracteres.',
    publicPreviewTitle: 'Pré-visualização pública',
    publicPreviewEmpty: 'Adicione carros para preencher sua página pública.',

    // Chunk 08 — IdentityCard + EditGarageSheet.
    invalidSlug: 'URL pode usar apenas letras minúsculas, números e hífens.',
    editSheetTitle: 'Editar Garagem',
    editSlugHint: 'Apenas letras minúsculas, números e hífens.',
    editVisibilityPublicConsequence: (slug: string) =>
      `Qualquer pessoa pode ver sua garagem em ${brand.urls.publicProfileBase.replace('https://', '')}/${slug}.`,
    welcomeTitle: 'Bem-vindo à sua Garagem',
    welcomeBody: (limit: number | null) =>
      limit === null
        ? 'Toque numa vaga abaixo para adicionar seu primeiro carro. Você tem vagas ilimitadas.'
        : `Toque numa vaga abaixo para adicionar seu primeiro carro. Você tem ${limit} ${limit === 1 ? 'vaga grátis' : 'vagas grátis'}.`,
    welcomeGlyph: '✨',
    expiredTitle: 'Seu Premium expirou',
    expiredBody:
      'Sua garagem continua acessível, mas o selo Premium e a capa personalizada foram desativados. Renove para reativá-los.',
    sectionVagasTitle: 'Vagas',
    sectionVagasMode: {
      gratis: 'GRÁTIS',
      gratisExtra: 'GRÁTIS + EXTRA',
      atCap: 'NO LIMITE',
      unlimited: 'ILIMITADO',
    },
    sectionVagasUnlimitedDenom: '∞',
    sectionVagasUnknownDenom: '—',

    // IdentityCard pills + action buttons.
    carCountLabel: (count: number) => (count === 1 ? 'CARRO' : 'CARROS'),
    visibilityPublicShort: 'Pública',
    visibilityPrivateShort: 'Privada',
    actionCoverLabel: 'Capa',
    actionEditLabel: 'Editar',
    actionShareLinkLabel: 'Link',
    actionShareLabel: 'Compartilhar',
    slugUrlPrefix: `${brand.urls.publicProfileBase.replace('https://', '')}/`,
    coverButtonA11yLabel: 'Editar capa da garagem',

    // Chunk 09 — CoverPickerSheet.
    coverPickerTitle: 'Capa da Garagem',
    coverPickerHintFree:
      'Você está usando a capa padrão. Assinaturas Premium desbloqueiam 9 cenários curados e upload.',
    coverPickerHintPremium:
      'Escolha entre os 9 cenários curados ou envie sua imagem (JPG, PNG ou WebP; máx. 10 MB).',
    coverPickerCustomLabel: 'Personalizada',
    coverPickerPremiumPip: 'Premium',
    coverUploadButton: 'Enviar imagem',
    coverUploadHint: 'JPG, PNG ou WebP; máx. 10 MB',
    coverPickerSaveFailed: 'Não foi possível atualizar a capa.',
    coverPickerUploadFailed: 'Falha ao enviar a imagem.',
    coverPickerLoadFailed: 'Não foi possível carregar as capas.',

    // EditGarageSheet field labels + buttons.
    editFieldNameLabel: 'Nome',
    editFieldSlugLabel: 'URL pública',
    editFieldDescriptionLabel: 'Descrição',
    editToggleVisibilityLabel: 'Tornar pública',
    editCancelLabel: 'Cancelar',
    editSaveLabel: 'Salvar',

    // Premium explainer sheet
    premiumSheetTitle: 'O que é Premium?',
    premiumHeroTitle: `${brand.shortName} Premium`,
    premiumHeroBody:
      'Premium é uma membresia da sua conta. Aplica-se à garagem inteira — todos os carros recebem o selo automaticamente.',
    premiumTierLabel: (tier: 'gold' | 'silver' | 'bronze') => `${tier.toUpperCase()} TIER`,
    premiumNearExpiry: (n: number) =>
      `Expira em ${n} ${n === 1 ? 'dia' : 'dias'} · Renove para manter sua capa.`,
    // "Garagem em destaque" e "Página pública premium" foram removidos em
    // 2026-08-14: nenhum dos dois existe no código. A ordenação do feed é só
    // createdAt desc, sem termo de premium, e a página pública não tem rodapé
    // promocional para esconder. Prometer benefício não implementado é exposição
    // na regra 2.3.1 da App Store, e o spec de Apple Pay depende desta lista ser
    // verdadeira. Reintroduzir só junto da implementação.
    premiumBenefits: [
      { title: 'Capas personalizadas', sub: 'Escolha entre 9 cenários ou envie a sua.' },
      { title: 'Selo Premium', sub: 'Aparece nos seus carros em todo o app.' },
    ],
    premiumFooter:
      'Premium nunca limita o uso da sua garagem. Carros, ingressos e check-in continuam grátis.',
    closeA11yLabel: 'Fechar',

    // Chunk 10 — BuySpotSheet.
    buySpotSheetTitle: 'Comprar vaga adicional',
    buySpotItemTitle: 'Vaga adicional',
    buySpotItemSub: '+1 espaço permanente na sua garagem.',
    buySpotBulletOneTime: 'Pagamento único (não é assinatura).',
    buySpotBulletAvailability: 'A vaga aparece em até 60s após a confirmação.',
    buySpotBulletAutoReturn: 'Você volta para a garagem automaticamente.',
    buySpotCtaPix: 'Pix',
    buySpotCtaCard: 'Cartão',
    buySpotCtaPixA11y: 'Pagar com Pix',
    buySpotCtaCardA11y: 'Pagar com cartão',
    buySpotDisclaimer: 'Você pode cancelar antes de finalizar o pagamento.',
  },
} as const;

const en = {
  garage: {
    listTitle: 'Garage',

    buySpotFailed: 'Could not add the spot to your cart. Try again.',

    editName: 'Garage name',
    editSlug: 'Public URL (/g/)',
    editDescription: 'Description',
    descriptionPlaceholder: 'Tell us about your garage (optional)',
    visibilityTitle: 'Visibility',
    visibilityPublicLabel: 'Make public',
    visibilityPublicHint: 'Your garage is visible at /g/<slug>.',
    visibilityPrivateHint: 'Only you can see this garage.',
    shareLink: 'Share link',
    shareLinkDisabledHint: 'Enable public visibility to share.',
    saveSuccess: 'Garage updated.',
    saveFailed: 'Could not update the garage.',
    slugTaken: 'This URL is already taken. Choose another.',
    reservedSlug: 'This URL is unavailable. Choose another.',
    nameTooLong: 'Name must be between 1 and 50 characters.',
    descriptionTooLong: 'Description can be at most 500 characters.',
    publicPreviewTitle: 'Public preview',
    publicPreviewEmpty: 'Add cars to populate your public page.',

    // Chunk 08 — IdentityCard + EditGarageSheet.
    invalidSlug: 'URL can only use lowercase letters, numbers, and hyphens.',
    editSheetTitle: 'Edit Garage',
    editSlugHint: 'Only lowercase letters, numbers, and hyphens.',
    editVisibilityPublicConsequence: (slug: string) =>
      `Anyone can view your garage at ${brand.urls.publicProfileBase.replace('https://', '')}/${slug}.`,
    welcomeTitle: 'Welcome to your Garage',
    welcomeBody: (limit: number | null) =>
      limit === null
        ? 'Tap a spot below to add your first car. You have unlimited spots.'
        : `Tap a spot below to add your first car. You have ${limit} ${limit === 1 ? 'free spot' : 'free spots'}.`,
    welcomeGlyph: '✨',
    expiredTitle: 'Your Premium has expired',
    expiredBody:
      'Your garage stays accessible, but the Premium badge and custom cover are disabled. Renew to bring them back.',
    sectionVagasTitle: 'Spots',
    sectionVagasMode: {
      gratis: 'FREE',
      gratisExtra: 'FREE + EXTRA',
      atCap: 'AT CAP',
      unlimited: 'UNLIMITED',
    },
    sectionVagasUnlimitedDenom: '∞',
    sectionVagasUnknownDenom: '—',

    // IdentityCard pills + action buttons.
    carCountLabel: (count: number) => (count === 1 ? 'CAR' : 'CARS'),
    visibilityPublicShort: 'Public',
    visibilityPrivateShort: 'Private',
    actionCoverLabel: 'Cover',
    actionEditLabel: 'Edit',
    actionShareLinkLabel: 'Link',
    actionShareLabel: 'Share',
    slugUrlPrefix: `${brand.urls.publicProfileBase.replace('https://', '')}/`,
    coverButtonA11yLabel: 'Edit garage cover',

    // Chunk 09 — CoverPickerSheet.
    coverPickerTitle: 'Garage cover',
    coverPickerHintFree:
      "You're on the default cover. Premium unlocks 9 curated scenes and custom uploads.",
    coverPickerHintPremium:
      'Pick one of the 9 curated scenes or upload your own (JPG, PNG, or WebP; max 10 MB).',
    coverPickerCustomLabel: 'Custom',
    coverPickerPremiumPip: 'Premium',
    coverUploadButton: 'Upload image',
    coverUploadHint: 'JPG, PNG, or WebP; max 10 MB',
    coverPickerSaveFailed: 'Could not update the cover.',
    coverPickerUploadFailed: 'Image upload failed.',
    coverPickerLoadFailed: 'Could not load covers.',

    // EditGarageSheet field labels + buttons.
    editFieldNameLabel: 'Name',
    editFieldSlugLabel: 'Public URL',
    editFieldDescriptionLabel: 'Description',
    editToggleVisibilityLabel: 'Make public',
    editCancelLabel: 'Cancel',
    editSaveLabel: 'Save',

    // Premium explainer sheet
    premiumSheetTitle: 'What is Premium?',
    premiumHeroTitle: `${brand.shortName} Premium`,
    premiumHeroBody:
      'Premium is a membership on your account. It applies to your entire garage — every car gets the badge automatically.',
    premiumTierLabel: (tier: 'gold' | 'silver' | 'bronze') => `${tier.toUpperCase()} TIER`,
    premiumNearExpiry: (n: number) =>
      `Expires in ${n} ${n === 1 ? 'day' : 'days'} · Renew to keep your cover.`,
    // Same removal as the PT list above. This is the one an English-speaking
    // reviewer reads.
    premiumBenefits: [
      { title: 'Custom covers', sub: 'Pick from 9 scenes or upload your own.' },
      { title: 'Premium badge', sub: 'Appears on your cars across the app.' },
    ],
    premiumFooter:
      'Premium never limits your garage usage. Cars, tickets and check-in remain free.',
    closeA11yLabel: 'Close',

    // Chunk 10 — BuySpotSheet.
    buySpotSheetTitle: 'Buy extra spot',
    buySpotItemTitle: 'Extra spot',
    buySpotItemSub: '+1 permanent space in your garage.',
    buySpotBulletOneTime: 'One-time payment (not a subscription).',
    buySpotBulletAvailability: 'Your spot appears within 60s of confirmation.',
    buySpotBulletAutoReturn: 'You return to your garage automatically.',
    buySpotCtaPix: 'Pix',
    buySpotCtaCard: 'Card',
    buySpotCtaPixA11y: 'Pay with Pix',
    buySpotCtaCardA11y: 'Pay with card',
    buySpotDisclaimer: 'You can cancel before completing payment.',
  },
} as const;

export const garageCopy = ptBR;
export const garageCopyEn = en;
export type GarageCopy = typeof ptBR;
