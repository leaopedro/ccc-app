export const feedCopy = {
  title: 'Feed',
  strip: {
    buyTicket: 'Comprar ingresso',
  },
  composer: {
    placeholder: 'Compartilhe algo com a galera…',
    postingAs: 'Postando como',
    noCar: 'Crie o perfil público do seu carro',
    noCar_hint: 'Para postar no feed, você precisa de um carro com perfil público.',
    submit: 'Publicar',
    submitting: 'Publicando…',
    photo: 'Adicionar foto',
    edit: 'Editar post',
    deleteConfirm: 'Tem certeza que quer excluir este post?',
    delete: 'Excluir',
    cancel: 'Cancelar',
  },
  post: {
    reactions: {
      like: 'Curtir',
      dislike: 'Não curtir',
    },
    comments: {
      show: (n: number) => `Ver ${n} comentário${n === 1 ? '' : 's'}`,
      hide: 'Ocultar comentários',
      placeholder: 'Adicionar comentário…',
      submit: 'Enviar',
    },
    menu: {
      edit: 'Editar',
      delete: 'Excluir',
    },
  },
  locked: {
    viewLocked: 'Este feed é exclusivo para participantes.',
    viewLockedCta: 'Comprar ingresso',
    postLocked: 'Apenas participantes podem postar.',
    postLockedCta: 'Comprar ingresso',
  },
  pagination: {
    loadMore: (n: number) => `Ver mais ${n} posts`,
    loading: 'Carregando…',
    noMore: 'Isso é tudo por enquanto.',
    empty: 'Nenhum post ainda. Seja o primeiro!',
  },
  errors: {
    loadFailed: 'Não foi possível carregar o feed.',
    postFailed: 'Erro ao publicar. Tente de novo.',
    commentFailed: 'Erro ao comentar. Tente de novo.',
    reactionFailed: 'Erro ao reagir. Tente de novo.',
    noProfileSelected: 'Selecione um perfil para continuar.',
  },
} as const;
