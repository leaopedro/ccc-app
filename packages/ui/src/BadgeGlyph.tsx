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
} from 'lucide-react-native';

/**
 * BadgeGlyph — Lucide-RN icon resolver keyed by the free-form `icon` string
 * stored in `BadgeCatalogEntry.icon` (1–40 chars, validated by
 * `badgeCatalogEntrySchema` in `@ccc/shared/badges`). The seed catalog
 * (packages/db/prisma/seed.ts, lines 428–483) uses the 12 wire strings
 * mapped below. Unknown strings render `HelpCircle` so a future catalog
 * addition can never crash the client — the renderer degrades to a
 * placeholder until the mobile build picks up the new mapping.
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` BadgeGlyph (lines
 * 181–385). The web canon uses inline-SVG paths; the RN port substitutes
 * Lucide-RN icons that match the same metaphor.
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
  /** Pixel size of the glyph. The HexBadge sizes this at ~50% of outer. */
  size: number;
  /** Stroke colour passed straight to the Lucide icon. */
  color: string;
}

export function BadgeGlyph({ name, size, color }: BadgeGlyphProps) {
  const Icon = ICON_MAP[name] ?? HelpCircle;
  const props: LucideProps = { size, color, strokeWidth: 1.75 };
  return <Icon {...props} />;
}
