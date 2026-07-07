// Test stub for `lucide-react-native` (mirrors apps/mobile/test-stubs/lucide-react-native.tsx).
//
// Why: vitest can't transform the real package's ESM build under jsdom
// ("Unexpected token 'typeof'" SyntaxError on transitive load). The
// `@jdm/ui` barrel re-exports components (`BadgeGlyph`, `XPTooltip`)
// that pull lucide directly, so every test that touches the barrel
// loads lucide transitively. Per canon §13, `@jdm/ui` ships its own
// copy of the stub so tests in this package stand alone — they do not
// reach into the mobile workspace for fixtures.
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
export const Car = proxy.Car;
export const CheckSquare = proxy.CheckSquare;
export const Crown = proxy.Crown;
export const Flag = proxy.Flag;
export const Flame = proxy.Flame;
export const Heart = proxy.Heart;
export const HelpCircle = proxy.HelpCircle;
export const Home = proxy.Home;
export const Library = proxy.Library;
export const Lock = proxy.Lock;
export const MapPin = proxy.MapPin;
export const Medal = proxy.Medal;
export const MessageCircle = proxy.MessageCircle;
export const MessageSquare = proxy.MessageSquare;
export const ShieldCheck = proxy.ShieldCheck;
export const TrendingUp = proxy.TrendingUp;
