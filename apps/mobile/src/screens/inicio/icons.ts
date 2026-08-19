// Mapa de chave de ícone para glifo lucide.
//
// O handoff especifica nomes do Material Symbols, mas o app usa
// lucide-react-native. As chaves guardadas em HomeBenefit.icon são desta
// tabela, não do Material. Chave desconhecida cai em Star, para conteúdo novo
// cadastrado no banco nunca derrubar a tela.

import {
  Calendar,
  Car,
  CalendarCheck,
  Crown,
  Gift,
  Handshake,
  Package,
  Sparkles,
  Star,
  Store,
  Sun,
  Tag,
  Ticket,
  Users,
} from 'lucide-react-native';

const HOME_ICON = {
  calendar: Calendar,
  'calendar-check': CalendarCheck,
  car: Car,
  gift: Gift,
  handshake: Handshake,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  tag: Tag,
  users: Users,
  ticket: Ticket,
  store: Store,
  box: Package,
  crown: Crown,
} as const;

export type HomeIconKey = keyof typeof HOME_ICON;

export const homeIcon = (key: string): (typeof HOME_ICON)[HomeIconKey] =>
  HOME_ICON[key as HomeIconKey] ?? Star;
