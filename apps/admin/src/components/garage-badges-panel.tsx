'use client';

import type { BadgeCatalogEntry } from '@jdm/shared/badges';
import { HexBadge } from '@jdm/ui/web';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { grantAdminUserBadgeAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
  /** Full badge catalog from `GET /badges/catalog` (chunk 16). Empty when
   *  the global killswitch is off or the upstream fetch failed. */
  catalog: BadgeCatalogEntry[];
  /** Codes the user has already earned. Best-effort: chunk 20 fetches
   *  pinned-only badges from the public garage payload because no admin
   *  badge READ endpoint exists yet. Unpinned-earned badges therefore
   *  show as not-earned in the indicator but the API call still returns
   *  `already_earned` and the panel surfaces that error inline. */
  earnedCodes: string[];
  /** Drives whether granting a `premiumExclusive` badge needs the
   *  bypass-confirm dialog. Same flag the awarder uses server-side. */
  isPremiumActive: boolean;
}

const categoryLabel: Record<BadgeCatalogEntry['category'], string> = {
  eventos: 'Eventos',
  carros: 'Carros',
  comunidade: 'Comunidade',
  jdm: 'CCC',
};

const CATEGORY_ORDER: BadgeCatalogEntry['category'][] = ['eventos', 'carros', 'comunidade', 'jdm'];

type PendingConfirm = {
  code: string;
  category: BadgeCatalogEntry['category'];
};

export function GarageBadgesPanel({ userId, catalog, earnedCodes, isPremiumActive }: Props) {
  const router = useRouter();
  const [pendingCodes, setPendingCodes] = useState<ReadonlySet<string>>(() => new Set());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const earnedSet = new Set(earnedCodes);

  const addPending = (c: string) => setPendingCodes((p) => new Set(p).add(c));
  const clearPending = (c: string) =>
    setPendingCodes((p) => {
      if (!p.has(c)) return p;
      const n = new Set(p);
      n.delete(c);
      return n;
    });

  const runGrant = useCallback(
    (code: string) => {
      addPending(code);
      startTransition(async () => {
        setError(null);
        try {
          const res = await grantAdminUserBadgeAction(userId, code);
          if (res.ok) router.refresh();
          else setError({ code, message: res.error });
        } finally {
          clearPending(code);
        }
      });
    },
    [router, userId],
  );

  const lastFocusedRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const handleGrantClick = useCallback(
    (entry: BadgeCatalogEntry, originBtn: HTMLButtonElement | null) => {
      // Admin-override path: warn before bypassing the premium gate so
      // staff don't grant CAR-003/JDM-003/etc. to non-premium users by
      // accident. The server bypass still ships (chunk 18) — the dialog
      // exists to force a deliberate click.
      if (entry.premiumExclusive && !isPremiumActive) {
        lastFocusedRef.current = originBtn;
        setConfirm({ code: entry.code, category: entry.category });
        return;
      }
      runGrant(entry.code);
    },
    [isPremiumActive, runGrant],
  );

  const dismissConfirm = useCallback(() => {
    setConfirm(null);
    lastFocusedRef.current?.focus();
  }, []);

  // Focus the Cancel button when the dialog opens.
  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  // Focus trap + Esc dismiss. Mirrors the AddUserToGroupModal a11y pattern
  // (same admin shell).
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissConfirm();
        return;
      }
      if (e.key !== 'Tab') return;
      const c = cancelRef.current;
      const k = confirmRef.current;
      if (!c || !k) return;
      const a = document.activeElement;
      // Two-button trap: Tab from either button moves to the other one.
      // Forward-direction (Tab from Cancel→Conceder, Shift-Tab from
      // Conceder→Cancel) would happen naturally in a real browser, but
      // jsdom doesn't navigate on Tab — so the trap handles both ends.
      if (a === c) {
        e.preventDefault();
        k.focus();
      } else if (a === k) {
        e.preventDefault();
        c.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm, dismissConfirm]);

  if (catalog.length === 0) {
    return (
      <div>
        <h2 className="mb-2 text-lg font-semibold">Conquistas</h2>
        <p className="text-sm text-fg-secondary">
          Catálogo de conquistas indisponível. Conquistas podem estar desativadas.
        </p>
      </div>
    );
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    entries: catalog.filter((b) => b.category === cat),
  })).filter((g) => g.entries.length > 0);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Conquistas</h2>
        <span className="text-xs text-fg-secondary">
          {earnedSet.size} de {catalog.length} concedidas
        </span>
      </div>

      <div className="flex flex-col gap-5 rounded border border-[color:var(--color-border)] bg-surface p-4">
        {grouped.map(({ category, entries }) => (
          <section key={category}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-secondary">
              {categoryLabel[category]}
            </h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {entries.map((entry) => {
                const isEarned = earnedSet.has(entry.code);
                const variant = isEarned
                  ? 'earned'
                  : entry.premiumExclusive && !isPremiumActive
                    ? 'locked_premium'
                    : 'locked';
                const isError = error?.code === entry.code;
                return (
                  <li
                    key={entry.code}
                    className="flex flex-col items-center gap-2 rounded border border-[color:var(--color-border)] bg-surface-alt p-3 text-center"
                  >
                    <HexBadge
                      code={entry.code}
                      variant={variant}
                      rarity={entry.rarity}
                      icon={entry.icon}
                      size="md"
                    />
                    <span className="font-mono text-[11px] text-fg-secondary">{entry.code}</span>
                    {isEarned ? (
                      <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                        Conquistada
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingCodes.has(entry.code)}
                        onClick={(e) => handleGrantClick(entry, e.currentTarget)}
                        className="rounded border border-[color:var(--color-border)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wider hover:bg-[color:var(--color-border)] disabled:opacity-50"
                      >
                        Conceder
                      </button>
                    )}
                    {isError ? (
                      <span className="text-[11px] text-red-400">{error?.message}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {confirm ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={dismissConfirm}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal={true}
            aria-labelledby="grant-confirm-title"
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-surface-deep p-6 shadow-2xl"
          >
            <h2 id="grant-confirm-title" className="mb-3 text-lg font-semibold">
              Conceder conquista Exclusivo Premium?
            </h2>
            <p className="mb-2 text-sm text-fg-secondary">
              A conquista{' '}
              <code className="rounded bg-[color:var(--color-border)] px-1 py-0.5 font-mono">
                {confirm.code}
              </code>{' '}
              é Exclusivo Premium e este usuário não é Premium ativo.
            </p>
            <p className="mb-4 text-sm text-fg-secondary">
              A concessão administrativa ignora a trava de Premium. Use apenas para casos de
              suporte. A ação fica registrada na Auditoria.
            </p>
            <div className="flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={dismissConfirm}
                className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]"
              >
                Cancelar
              </button>
              <button
                ref={confirmRef}
                type="button"
                disabled={pendingCodes.has(confirm.code)}
                onClick={() => {
                  const code = confirm.code;
                  setConfirm(null);
                  runGrant(code);
                  lastFocusedRef.current?.focus();
                }}
                className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                Conceder mesmo assim
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
