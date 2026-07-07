import { brand } from '@jdm/design';

export const storeCopy = {
  header: {
    eyebrow: `Loja ${brand.shortName}`,
    title: 'Drops, peças e itens do paddock.',
    subtitle:
      'Busque por coleção, tipo ou peça favorita e adicione ao carrinho sem sair da vitrine.',
  },
  search: {
    label: 'Buscar produto',
    placeholder: 'Camiseta, adesivo, boné...',
  },
  filters: {
    productTypes: 'Tipos',
    collections: 'Coleções',
    allProductTypes: 'Todos os tipos',
    allCollections: 'Todas as coleções',
  },
  summary: {
    itemCount: (count: number) => `${count} ${count === 1 ? 'produto' : 'produtos'}`,
  },
  actions: {
    add: 'Adicionar',
    adding: 'Adicionando...',
    added: 'Produto adicionado ao carrinho.',
    soldOut: 'Esgotado',
    confirmVariant: 'Adicionar',
    cancelVariant: 'Agora não',
    retry: 'Tentar novamente',
    openCart: 'Abrir carrinho',
    openCartWithCount: (count: number) =>
      `Abrir carrinho, ${count} ${count === 1 ? 'item' : 'itens'}`,
    back: 'Voltar',
    decreaseQuantity: 'Diminuir quantidade',
    increaseQuantity: 'Aumentar quantidade',
  },
  stock: {
    unavailable: 'Indisponível',
    soldOut: 'Esgotado',
    remaining: (count: number) => `${count} restantes`,
    remainingPercent: (percent: number) => `${percent}% restantes`,
  },
  variantPicker: {
    title: 'Escolha a variação',
    subtitle: 'Selecione tamanho, modelo ou opção disponível antes de adicionar ao carrinho.',
    label: 'Opções disponíveis',
    confirmHint: 'Selecione uma opção para continuar.',
  },
  states: {
    loading: 'Carregando vitrine...',
    empty: 'Nenhum produto encontrado com esses filtros.',
    emptyHint: 'Limpe a busca ou troque os chips para ver mais itens.',
    error: 'Não foi possível carregar a loja agora.',
  },
  badges: {
    shipping: 'Entrega',
    pickup: 'Retirada',
  },
  pagination: {
    loadingMore: 'Carregando mais produtos...',
  },
  eyebrow: `Loja ${brand.shortName}`,
  listTitle: 'Produtos oficiais',
  listError: 'Não foi possível carregar os produtos da loja.',
  notFound: 'Não foi possível carregar este produto.',
  retry: 'Tentar novamente',
  collections: 'Coleções',
  variants: 'Escolha a variação',
  variantSheetTitle: 'Selecione sua variação',
  chooseVariant: 'Escolher variação',
  selectedVariant: 'Variação selecionada',
  closeSheet: 'Fechar seletor',
  quantity: 'Quantidade',
  description: 'Descrição',
  shipping: 'Entrega',
  pickup: 'Retirada no evento',
  addToCart: 'Adicionar',
  adding: 'Adicionando...',
  added: 'Produto adicionado ao carrinho.',
  soldOut: 'Selecione uma variação disponível',
  unavailable: 'Produto indisponível no momento',
};
