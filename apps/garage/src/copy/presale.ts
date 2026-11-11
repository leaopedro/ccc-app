// Copy PT-BR única da pré-venda Casa In Box no app garage. Toda string
// visível desta feature mora aqui — nenhum literal solto em componente
// (CLAUDE.md: "idioma de toda copy visível: PT-BR, em módulo de copy único
// por app"). Consumido pela landing page (Task 14).

export const presaleCopy = {
  hero: {
    eyebrow: 'Pré-venda',
    title: 'Casa In Box',
    subtitle: 'Garanta a sua caixa antes do primeiro lote esgotar.',
    cta: 'Quero a minha caixa',
    firstBatchLabel: (label: string) => `Primeiro lote: ${label}`,
    // A foto do dono do produto (boné, camiseta, carteira, chaveiro e dois
    // cheirinhos) não inclui flanela, garrafa térmica nem adesivos, que também
    // vêm na caixa. Sem esta legenda a foto afirma um conteúdo que a caixa não
    // entrega. Task 14, item "Hero: slot sim, binário não".
    photoCaption:
      'Composição ilustrativa. A caixa real também inclui flanela, garrafa térmica e adesivos.',
    photoAlt: 'Itens da Casa In Box dispostos sobre uma caixa escura',
  },

  steps: {
    title: 'Como funciona',
    items: [
      { title: 'Escolha o seu tier', body: 'Compare o que vem em cada caixa e escolha a sua.' },
      {
        title: 'Escolha como receber',
        body: 'Retirada na Pocket CASA ou entrega no seu endereço.',
      },
      {
        title: 'Pague com segurança',
        body: 'Pagamento processado pela Stripe. Acompanhe pelo e-mail de confirmação.',
      },
    ],
  },

  faq: {
    title: 'Perguntas frequentes',
    // `requiresField` nomeia a chave de PresaleCampaign que precisa estar
    // preenchida para a pergunta aparecer. Sem o campo, a pergunta some —
    // ver `visibleFaqItems` em components/presale/selection.ts. Itens sem
    // `requiresField` aparecem sempre.
    items: [
      {
        question: 'Quando a caixa chega?',
        body: 'Assim que o primeiro lote for produzido, dentro do prazo informado na página da campanha.',
        requiresField: 'firstBatchLabel',
      },
      {
        question: 'Posso retirar em vez de receber em casa?',
        body: 'Sim, a retirada é feita no Pocket CASA, no endereço e horário informados no checkout.',
        requiresField: 'pickupAddress',
      },
      {
        question: 'Minha região está coberta pela entrega?',
        body: 'A entrega cobre a área informada na página. Fora dela, escolha a retirada.',
        requiresField: 'deliveryAreaLabel',
      },
      {
        question: 'Como funciona o pagamento?',
        body: 'O pagamento é processado pela Stripe. Seus dados de cartão não passam pelos nossos servidores.',
      },
    ],
  },

  // Conteúdo de cada caixa. Vem da copy, não da API — só título e preço vêm
  // dos produtos (Task 14: "a lista de conteúdo de cada caixa vem da copy").
  tierContents: {
    basic: [
      'Carteira',
      'Chaveiro',
      'Flanela',
      'Garrafa térmica',
      'Kit de brindes (cheirinhos e adesivos)',
    ],
    premium: [
      'Carteira',
      'Chaveiro',
      'Flanela',
      'Garrafa térmica',
      'Kit de brindes (cheirinhos e adesivos)',
      'Camiseta',
      'Boné',
    ],
  },

  tier: {
    priceLabel: 'Preço',
    stockLow: 'Últimas unidades',
    soldOut: 'Esgotado',
    unavailable: 'Indisponível no momento',
    selectCta: 'Selecionar',
    selectedCta: 'Selecionado',
    contentsTitle: 'O que vem na caixa',
  },

  sizeSelector: {
    label: 'Tamanho da camiseta',
  },

  guest: {
    title: 'Seus dados',
    nameLabel: 'Nome completo',
    emailLabel: 'E-mail',
    phoneLabel: 'Telefone (opcional)',
  },

  delivery: {
    title: 'Endereço de entrega',
    recipientNameLabel: 'Nome de quem recebe',
    line1Label: 'Rua',
    numberLabel: 'Número',
    districtLabel: 'Bairro',
    cityLabel: 'Cidade',
    stateCodeLabel: 'UF',
    postalCodeLabel: 'CEP',
  },

  fulfillment: {
    title: 'Como você quer receber?',
    pickup: 'Retirada',
    ship: 'Entrega',
    pickupAddressLabel: 'Endereço de retirada',
    pickupHoursLabel: 'Horário de retirada',
    deliveryAreaLabel: (label: string) => `Entregamos em: ${label}`,
    shippingFeeLabel: (amount: string) => `Taxa de entrega: ${amount}`,
  },

  // Checkbox de consentimento, obrigatório antes de pagar (ADENDO do brief
  // amendado — consentimento informado precisa linkar para o documento real,
  // não só mencioná-lo). `privacyLabel`/`termsLabel` são os textos que viram
  // os links para /privacidade e /termos; o componente monta o <a>, a copy
  // só guarda o texto.
  consent: {
    prefix: 'Li e aceito a ',
    privacyLabel: 'política de privacidade',
    middle: ' e os ',
    termsLabel: 'termos de uso',
    suffix: '.',
  },

  checkout: {
    submitCta: 'Confirmar pedido',
    submitting: 'Processando pedido...',
  },

  errors: {
    // 409 do checkout: o servidor recalculou preço/estoque e discorda do que
    // o cliente mandou. Resposta certa é recarregar, nunca "corrija o form".
    conflict: {
      title: 'O pedido mudou',
      body: 'O preço ou o estoque foi atualizado. Recarregue a página e tente novamente.',
    },
    // 422 do checkout: o payload em si falhou validação. Resposta certa é
    // corrigir o formulário, nunca recarregar.
    invalid: {
      title: 'Dados inválidos',
      body: 'Revise os campos do formulário e tente novamente.',
    },
    generic: {
      title: 'Não foi possível concluir',
      body: 'Algo deu errado. Tente novamente em instantes.',
    },
  },

  // Estados do pedido na página /obrigado. O status real do pedido tem mais
  // valores (pending, paid, refunded, failed, expired, cancelled — ver
  // orderStatusSchema em packages/shared/src/orders.ts), mas a tela distingue
  // só quatro: pendente, pago, reembolsado, e "tente de novo" para o resto.
  orderStatus: {
    pending: {
      title: 'Processando seu pagamento',
      body: 'Assim que confirmarmos, você recebe um e-mail.',
    },
    paid: {
      title: 'Pagamento confirmado!',
      body: 'Seu pedido está garantido. Enviamos os detalhes para o seu e-mail.',
      itemsTitle: 'O que você vai receber',
      itemQuantity: (quantity: number) => `${quantity}x`,
      totalLabel: 'Total pago',
      // Fallback para retirada quando a campanha ainda não respondeu (ou
      // falhou): nunca mostra um endereço de entrega vazio no lugar.
      pickupFallback: 'Consulte o endereço e o horário de retirada no e-mail de confirmação.',
    },
    refunded: {
      title: 'Pedido reembolsado',
      body: 'Este pedido foi reembolsado. Qualquer dúvida, fale com a gente.',
    },
    failed: {
      title: 'Pagamento não concluído',
      body: 'Não foi possível confirmar o pagamento. Tente novamente.',
      retryCta: 'Tentar novamente',
    },
    // Teto do polling (page.tsx) estourado ainda em `pending`: a liquidação
    // vem de webhook da Stripe, então parar de girar e oferecer checagem
    // manual em vez de tentar para sempre.
    pollingTimeout: {
      body: 'Isso está demorando mais que o esperado. Você pode verificar de novo a qualquer momento.',
      checkAgainCta: 'Verificar novamente',
    },
    // orderId/token ausentes na querystring da própria página — não é um dos
    // quatro estados do pedido, é a página nem conseguindo perguntar por ele.
    missingParams: {
      title: 'Link incompleto',
      body: 'Este link está incompleto. Use o link enviado no e-mail de confirmação do pedido.',
    },
    // 404 do endpoint de status: o token não bateu com o pedido.
    notFound: {
      title: 'Pedido não encontrado',
      body: 'Não encontramos esse pedido com esse link. Confira se copiou o link completo do e-mail de confirmação.',
    },
    loading: {
      title: 'Carregando seu pedido...',
    },
  },
};
