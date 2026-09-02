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
    //
    // 2026-08-31: a caixa física e os eventos da comunidade entram aqui por
    // causa da Decisão 6 (3.1.3(e) exige que o app venda algo consumido fora
    // dele; um sheet "O que é Premium?" com só dois desbloqueios digitais
    // argumenta contra a própria posição de compliance). Esta lista não sabe
    // o tier de quem está lendo — CoverPickerSheet abre este sheet também
    // para quem ainda não é assinante (GarageHeader.tsx, onPremiumUpsell) —
    // então só entra o que TODO tier tem, verificado em seed.ts (benefícios
    // do plano Bronze): a caixa e "Eventos abertos da comunidade". Convidados,
    // descontos com parceiros e concierge ficam de fora — são só a partir da
    // Prata/Ouro (seed.ts) — e módulos como Detailing ficam de fora: são
    // add-on pago à parte, não um benefício incluso, e Oficina nem está
    // ativo no catálogo.
    //
    // Fix round 1: "Acesso ao clube" foi removido. Os únicos indícios eram
    // rótulos de marketing do seed (dado de dev/preview); não existe nenhum
    // gate de entitlement no código — fridge-unlock.ts autentica por chave de
    // API compartilhada, não por membro ou tier, e check-in é por ingresso,
    // não por premium. Prometer isso seria a mesma exposição 2.3.1 que a
    // advertência acima cobre. "incluída na assinatura" também saiu da caixa:
    // a cobrança real soma excedente do orçamento + módulos + frete
    // (box/charge.ts), então "incluída" sem ressalva é falso fora do caso
    // dentro do orçamento e do único CEP com frete grátis (seed.ts). A
    // advertência acima continua valendo para qualquer item novo que ainda
    // não exista no produto.
    // Fix round 2 (C2): the caixa lives OUTSIDE `premiumBenefits` because it is
    // conditional on EXPO_PUBLIC_CAIXA_ENABLED. With that flag off the member
    // can never opt in, add items, or set an address — and box-cutoff.ts skips
    // exactly those boxes (`!hasItems || !autoSendOptIn || !shippingAddressId`).
    // The flag went `true` in all three eas profiles on 2026-09-01; the split
    // stays, because a future build that turns it back off must not silently
    // start promising the box again.
    // Promising it in a build that cannot deliver it is the same 2.3.1 exposure
    // the notes above cover. `premiumSheetBenefits` (screens/garage) puts it
    // back at the top of the list when the flag is on, matching how
    // ContratarScreen and PlanoDetalheScreen gate their caixa card.
    premiumBenefitCaixa: {
      title: 'Caixa física da Casa',
      sub: 'Você monta e confirma sua caixa a cada ciclo.',
    },
    // Fix round 2 (I3): "Eventos abertos da comunidade" was removed. Its only
    // evidence was a seed marketing label (seed.ts:526) — exactly the evidence
    // rejected above for "Acesso ao clube". No code gates event attendance on
    // membership or tier: `Event` has no membership field in schema.prisma, and
    // the only `minTier` in the codebase gates BOX CATALOG items (box.ts,
    // box-cutoff.ts), not events. Either events are open to everyone, in which
    // case they are not a member benefit, or the claim is unbacked.
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
    // Kept in lockstep with the PT list above — see those comments for why the
    // box sits behind the caixa build flag, and why club access, community
    // events, guests/discounts/concierge and addon modules are not listed at
    // all. Note: `garageCopyEn` has no importers in this app; PT is the copy an
    // App Store reviewer actually sees, whatever language they read in. This
    // EN block only exists as an i18n scaffold.
    premiumBenefitCaixa: {
      title: 'The Casa box',
      sub: 'You curate and confirm your box every cycle.',
    },
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
