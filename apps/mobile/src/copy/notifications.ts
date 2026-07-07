export const notificationsCopy = {
  title: 'Notificações',
  empty: 'Nenhuma notificação por enquanto.',
  emptySub: 'Quando houver novidades, elas aparecem aqui.',
  loadFailed: 'Não foi possível carregar as notificações.',
  retry: 'Tentar novamente',
  loadMore: 'Carregar mais',
  markRead: 'Marcar como lida',
  accessibilityBell: 'Notificações',
  accessibilityUnread: (count: number) =>
    `${count} notificaç${count === 1 ? 'ão' : 'ões'} não lida${count === 1 ? '' : 's'}`,
  menu: {
    label: 'Notificações',
    hint: 'Veja avisos e novidades do app',
  },
} as const;
