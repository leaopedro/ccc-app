import { brand } from '~/brand';

type Props = {
  /** Glyph shown in the circle. Inline SVG, sized by the caller. */
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Monospace stamp under the copy, e.g. `HTTP 404 · /g/<slug>`. */
  code: React.ReactNode;
};

/**
 * Shared chrome for both 404s in this app: the route-level one for an
 * unknown-or-private garage slug, and the root one for anything else.
 *
 * Render MUST stay deterministic — no dates, no randomness, no reads of
 * anything request-scoped. `app/g/[slug]/not-found.tsx` is covered by an
 * anti-enumeration spec asserting byte-identical markup across renders, so
 * that an unknown slug and a private garage are indistinguishable to a
 * scraper. Anything non-deterministic added here breaks that guarantee, and
 * the spec will (correctly) fail.
 */
export function NotFoundShell({ icon, title, description, code }: Props) {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-8 text-center">
      <div className="w-18 h-18 rounded-full bg-surface-alt border border-border flex items-center justify-center text-muted mb-4">
        {icon}
      </div>
      <h1 className="text-fg text-lg font-bold">{title}</h1>
      <p className="text-muted text-sm mt-1 leading-relaxed max-w-xs">{description}</p>
      <div className="mt-4 px-2.5 py-1.5 rounded bg-surface-alt border border-border text-muted text-[10px] tracking-wider font-mono">
        {code}
      </div>
      <a
        href={brand.urls.appBase}
        className="mt-6 text-muted hover:text-fg text-xs underline underline-offset-4 transition-colors"
      >
        Ir para {brand.urls.appBase.replace(/^https?:\/\//, '')}
      </a>
    </div>
  );
}
