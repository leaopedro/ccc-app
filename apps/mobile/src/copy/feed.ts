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
      report: 'Denunciar',
      block: 'Bloquear',
    },
    report: {
      title: 'Denunciar publicação',
      // Deliberately does NOT ask the person to describe the problem: this is a
      // two-button confirm and there is nowhere to type. Promising input we do
      // not collect is dishonest, and a reviewer reads these strings.
      prompt:
        'Um moderador vai avaliar esta publicação. Conteúdo muito denunciado fica oculto até a revisão.',
      submit: 'Denunciar',
      cancel: 'Cancelar',
      done: 'Denúncia enviada. Obrigado por avisar.',
      error: 'Não foi possível enviar a denúncia agora.',
    },
    block: {
      title: 'Bloquear esta pessoa?',
      // "ao atualizar" is honest: the client never learns the author id, so the
      // rest of their content clears on the next fetch, not instantly.
      body: 'Ao atualizar, você não vai mais ver publicações e comentários dela, e ela não vai ver os seus.',
      confirm: 'Bloquear',
      cancel: 'Cancelar',
      done: 'Pessoa bloqueada.',
      error: 'Não foi possível bloquear agora.',
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
