'use client';

import {
  BADGE_DESCRIPTION_MAX,
  BADGE_TITLE_MAX,
  RANK_KEYS,
  RANK_NAME_MAX,
  type AdminGamificationCopy,
} from '@ccc/shared/admin-gamification';
import { useState, useTransition } from 'react';

import { updateAdminGamificationCopyAction } from '~/lib/gamification-copy-actions';

const labelCls = 'flex flex-col gap-1 text-sm';
const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

const RANK_LABEL: Record<(typeof RANK_KEYS)[number], string> = {
  iniciante: 'Nível 1',
  pilotador: 'Nível 2',
  veterano: 'Nível 3',
  lendario: 'Nível 4',
  hall_of_fame: 'Nível 5',
};

export const GamificationCopyForm = ({ initial }: { initial: AdminGamificationCopy }) => {
  const [version, setVersion] = useState(initial.version);
  const [badges, setBadges] = useState(initial.badges);
  const [ranks, setRanks] = useState(initial.rankNames);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const patchBadge = (code: string, field: 'title' | 'description', value: string) =>
    setBadges((prev) => prev.map((b) => (b.code === code ? { ...b, [field]: value } : b)));

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateAdminGamificationCopyAction({
        expectedVersion: version,
        badges,
        rankNames: ranks,
      });
      if (result.ok) {
        setVersion(result.copy.version);
        setBadges(result.copy.badges);
        setRanks(result.copy.rankNames);
        setMessage({ kind: 'ok', text: 'Copy salva.' });
        return;
      }
      setMessage({ kind: 'error', text: result.error });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Níveis</h2>
        {RANK_KEYS.map((key) => (
          <label key={key} className={labelCls}>
            <span>
              {RANK_LABEL[key]} ({ranks[key].length}/{RANK_NAME_MAX})
            </span>
            <input
              className={inputCls}
              aria-label={`Nome do ${RANK_LABEL[key]}`}
              maxLength={RANK_NAME_MAX}
              value={ranks[key]}
              onChange={(e) => setRanks((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Conquistas</h2>
        {badges.map((b) => (
          <div
            key={b.code}
            className="flex flex-col gap-2 rounded border border-[color:var(--color-border)] p-3"
          >
            <span className="text-xs font-mono text-[color:var(--color-muted)]">{b.code}</span>
            <label className={labelCls}>
              <span>
                Título ({b.title.length}/{BADGE_TITLE_MAX})
              </span>
              <input
                className={inputCls}
                aria-label={`Título de ${b.code}`}
                maxLength={BADGE_TITLE_MAX}
                value={b.title}
                onChange={(e) => patchBadge(b.code, 'title', e.target.value)}
              />
            </label>
            <label className={labelCls}>
              <span>
                Descrição ({b.description.length}/{BADGE_DESCRIPTION_MAX})
              </span>
              <input
                className={inputCls}
                aria-label={`Descrição de ${b.code}`}
                maxLength={BADGE_DESCRIPTION_MAX}
                value={b.description}
                onChange={(e) => patchBadge(b.code, 'description', e.target.value)}
              />
            </label>
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
        >
          Salvar
        </button>
        {message ? (
          <p
            role="alert"
            className={message.kind === 'ok' ? 'text-sm text-green-400' : 'text-sm text-red-400'}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
};
