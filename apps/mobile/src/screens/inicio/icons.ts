// Mapa de chave de ícone para glifo lucide.
//
// O handoff especifica nomes do Material Symbols, mas o app usa
// lucide-react-native. As chaves guardadas em HomeBenefit.icon são desta
// tabela, não do Material. Chave desconhecida cai em Star, para conteúdo novo
// cadastrado no banco nunca derrubar a tela.
//
// HOME_ICON é tipado como Record<string, LucideIcon>, não `as const` mais
// cast de chave: com o cast, noUncheckedIndexedAccess não se aplica e o `??
// Star` vira código morto para o compilador, que passaria a marcá-lo como
// removível. Object.hasOwn barra chaves herdadas de Object.prototype (ex.:
// "constructor", "toString"), que HomeBenefit.icon pode conter vindas de um
// campo editável no admin.

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
  type LucideIcon,
} from 'lucide-react-native';

const HOME_ICON: Record<string, LucideIcon> = {
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
};

export const homeIcon = (key: string): LucideIcon =>
  (Object.hasOwn(HOME_ICON, key) ? HOME_ICON[key] : undefined) ?? Star;
