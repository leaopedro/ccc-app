import {
  Car,
  CheckSquare,
  Crown,
  Flag,
  Flame,
  HelpCircle,
  Home,
  Library,
  Lock,
  type LucideIcon,
  type LucideProps,
  MapPin,
  Medal,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

/**
 * BadgeGlyph (web) — Lucide-react resolver. Mirrors the RN twin in
 * `packages/ui/src/BadgeGlyph.tsx` (chunk 17) one-to-one: same 12 wire
 * strings → same Lucide metaphors, plus the `lock` + `shield` specials
 * always reachable for locked variants. Unknown strings degrade to
 * `HelpCircle` so a future catalog addition can never crash the SSR
 * render — admin picks up the mapping in the next deploy.
 *
 * Source of truth for the strings: `packages/db/prisma/seed.ts`
 * BADGES (lines 428–483) + the chunk 17 BadgeGlyph RN twin.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  // EVENTOS
  flag: Flag,
  streak: TrendingUp,
  medal: Medal,
  // CARROS
  car: Car,
  garageFull: Home,
  curator: Library,
  // COMUNIDADE
  post: MessageSquare,
  chat: MessageCircle,
  fire: Flame,
  // JDM
  pin: MapPin,
  flagCheck: CheckSquare,
  founder: Crown,
  // Special — always reachable for locked variants.
  lock: Lock,
  shield: ShieldCheck,
};

export interface BadgeGlyphProps {
  /** Catalog `icon` string (from `BadgeCatalogEntry.icon`). */
  name: string;
  /** Pixel size of the glyph. HexBadge sizes this at ~50% of outer. */
  size: number;
  /** Stroke colour passed straight to the Lucide icon. */
  color: string;
}

export function BadgeGlyph({ name, size, color }: BadgeGlyphProps) {
  const Icon = ICON_MAP[name] ?? HelpCircle;
  const props: LucideProps = { size, color, strokeWidth: 1.75 };
  return <Icon {...props} />;
}
