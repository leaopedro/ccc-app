// Test stub for `lucide-react-native`.
//
// Why: vitest can't transform the real package's ESM build under jsdom
// ("Unexpected token 'typeof'" SyntaxError on transitive load). Once
// chunk 17 added `BadgeGlyph` (imports `lucide-react-native`) to
// `packages/ui/src/index.ts`, EVERY mobile test that pulls anything
// from `@ccc/ui` started loading lucide via the barrel re-export —
// not just the new HexBadge/BadgeRow tests. Per-file vi.mock didn't
// scale (6 unrelated tests broke); a `resolve.alias` in
// `apps/mobile/vitest.config.ts` redirects all lucide imports here,
// and the new HexBadge/BadgeRow tests' explicit vi.mock calls still
// take precedence at the test level.
//
// The stub exports a Proxy that returns a forwardRef component for
// any icon name, so the catalog can grow without revisiting this file.

import { forwardRef, createElement, type ComponentType } from 'react';

export interface LucideProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  [key: string]: unknown;
}

export type LucideIcon = ComponentType<LucideProps>;

const makeIcon = (name: string): LucideIcon =>
  forwardRef<unknown, LucideProps>((props, ref) =>
    createElement('lucide-icon', {
      'data-icon': name,
      'data-size': props.size,
      'data-color': props.color,
      ref,
    }),
  );

const cache = new Map<string, LucideIcon>();

const handler: ProxyHandler<Record<string, LucideIcon>> = {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop === '__esModule') return true;
    if (prop === 'default') return undefined;
    let cached = cache.get(prop);
    if (!cached) {
      cached = makeIcon(prop);
      cache.set(prop, cached);
    }
    return cached;
  },
};

const proxy = new Proxy<Record<string, LucideIcon>>({}, handler);

export default proxy;

export const ArrowLeft = proxy.ArrowLeft;
export const Calendar = proxy.Calendar;
export const CalendarCheck = proxy.CalendarCheck;
export const Car = proxy.Car;
export const Check = proxy.Check;
export const CheckSquare = proxy.CheckSquare;
export const Crown = proxy.Crown;
export const Flag = proxy.Flag;
export const Flame = proxy.Flame;
export const Gift = proxy.Gift;
export const Handshake = proxy.Handshake;
export const HelpCircle = proxy.HelpCircle;
export const Home = proxy.Home;
export const Library = proxy.Library;
export const Lock = proxy.Lock;
export const MapPin = proxy.MapPin;
export const Medal = proxy.Medal;
export const MessageCircle = proxy.MessageCircle;
export const MessageSquare = proxy.MessageSquare;
export const Package = proxy.Package;
export const ShieldCheck = proxy.ShieldCheck;
export const Sparkles = proxy.Sparkles;
export const Star = proxy.Star;
export const Store = proxy.Store;
export const Sun = proxy.Sun;
export const Tag = proxy.Tag;
export const Ticket = proxy.Ticket;
export const TrendingUp = proxy.TrendingUp;
export const Users = proxy.Users;
