'use client';

import {
  type CapacityDisplayMode,
  type CapacityDisplayPolicy,
  type GeneralSettings,
  computeCapacityDisplay,
} from '@jdm/shared/general-settings';
import { useState, useTransition } from 'react';

import { updateAdminGeneralSettingsAction } from '~/lib/general-settings-actions';

const labelCls = 'flex flex-col gap-1 text-sm';
const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

type Surface = { key: keyof CapacityDisplayPolicy; title: string; description: string };
const surfaces: Surface[] = [
  {
    key: 'tickets',
    title: 'Ingressos',
    description: 'Como exibir o estoque por tier de ingresso.',
  },
  {
    key: 'extras',
    title: 'Extras',
    description: 'Como exibir disponibilidade dos extras dos eventos.',
  },
  {
    key: 'products',
    title: 'Produtos da loja',
    description: 'Como exibir estoque das variantes da loja.',
  },
];

const modeOptions: { value: CapacityDisplayMode; label: string }[] = [
  { value: 'absolute', label: 'Exato (número absoluto)' },
  { value: 'percentage_threshold', label: 'Percentual abaixo do limite' },
  { value: 'hidden', label: 'Ocultar' },
];

type SurfaceState = { mode: CapacityDisplayMode; thresholdPercent: string };
type PolicyState = Record<keyof CapacityDisplayPolicy, SurfaceState>;
type GarageSpotsState = { unlimited: boolean; value: string };
type FormState = { policy: PolicyState; defaultFreeGarageSpots: GarageSpotsState };

const toPolicyState = (policy: CapacityDisplayPolicy): PolicyState => ({
  tickets: {
    mode: policy.tickets.mode,
    thresholdPercent: String(policy.tickets.thresholdPercent),
  },
  extras: {
    mode: policy.extras.mode,
    thresholdPercent: String(policy.extras.thresholdPercent),
  },
  products: {
    mode: policy.products.mode,
    thresholdPercent: String(policy.products.thresholdPercent),
  },
});

const toGarageSpotsState = (value: number | null): GarageSpotsState => ({
  unlimited: value === null,
  value: value === null ? '0' : String(value),
});

const toFormState = (settings: GeneralSettings): FormState => ({
  policy: toPolicyState(settings.capacityDisplay),
  defaultFreeGarageSpots: toGarageSpotsState(settings.defaultFreeGarageSpots),
});

const previewLabel = (
  surface: keyof CapacityDisplayPolicy,
  mode: CapacityDisplayMode,
  thresholdPercent: number,
  remaining: number,
  total: number,
  status: 'available' | 'sold_out' | 'unavailable',
) => {
  const r = computeCapacityDisplay({ status, remaining, total }, { mode, thresholdPercent });
  if (r.status === 'sold_out') return 'Esgotado';
  if (r.status === 'unavailable') return 'Indisponível';
  if (r.showAbsolute && r.remaining != null) {
    if (surface === 'tickets') return `${r.remaining} disponíveis`;
    if (surface === 'extras') return `${r.remaining} restantes`;
    if (surface === 'products') return `${r.remaining} restantes`;
    return `${r.remaining}`;
  }
  if (r.showPercentage && r.remainingPercent != null) return `${r.remainingPercent}% restantes`;
  return '—';
};

export function GeneralSettingsForm({ initial }: { initial: GeneralSettings }) {
  const [state, setState] = useState<FormState>(toFormState(initial));
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  // Track last-saved garage cap so the "Reduzir o limite" warning compares
  // against the most recent server state, not the stale prop from first render.
  // Without this, a 5→3 save followed by 3→2 wouldn't show the warning because
  // `initial.defaultFreeGarageSpots` would still read 5.
  const [savedGarageSpots, setSavedGarageSpots] = useState<number | null>(
    initial.defaultFreeGarageSpots,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setSurfaceMode = (key: keyof CapacityDisplayPolicy, mode: CapacityDisplayMode) =>
    setState((prev) => ({
      ...prev,
      policy: { ...prev.policy, [key]: { ...prev.policy[key], mode } },
    }));

  const setSurfaceThreshold = (key: keyof CapacityDisplayPolicy, thresholdPercent: string) =>
    setState((prev) => ({
      ...prev,
      policy: { ...prev.policy, [key]: { ...prev.policy[key], thresholdPercent } },
    }));

  const setGarageUnlimited = (unlimited: boolean) =>
    setState((prev) => ({
      ...prev,
      defaultFreeGarageSpots: { ...prev.defaultFreeGarageSpots, unlimited },
    }));

  const setGarageValue = (value: string) =>
    setState((prev) => ({
      ...prev,
      defaultFreeGarageSpots: { ...prev.defaultFreeGarageSpots, value },
    }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const payload: NonNullable<
      Parameters<typeof updateAdminGeneralSettingsAction>[0]['capacityDisplay']
    > = {};

    for (const { key } of surfaces) {
      const surface = state.policy[key];
      const threshold = Number(surface.thresholdPercent);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
        setError(`Limite percentual de ${key} deve ser um inteiro entre 0 e 100.`);
        return;
      }
      payload[key] = { mode: surface.mode, thresholdPercent: threshold };
    }

    let garagePayload: number | null;
    const { unlimited, value } = state.defaultFreeGarageSpots;
    if (unlimited) {
      garagePayload = null;
    } else {
      // `Number('')` is 0, not NaN — without the empty-string guard a user who
      // clears the field and unchecks "Ilimitado" would silently downgrade the
      // global cap to 0 instead of seeing a validation error.
      if (value.trim() === '') {
        setError('Vagas de garagem grátis deve ser um inteiro maior ou igual a zero.');
        return;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setError('Vagas de garagem grátis deve ser um inteiro maior ou igual a zero.');
        return;
      }
      garagePayload = parsed;
    }

    startTransition(async () => {
      const result = await updateAdminGeneralSettingsAction({
        capacityDisplay: payload,
        defaultFreeGarageSpots: garagePayload,
      });
      if (result.ok) {
        setState(toFormState(result.settings));
        setUpdatedAt(result.settings.updatedAt);
        setSavedGarageSpots(result.settings.defaultFreeGarageSpots);
        setSuccess('Configurações salvas.');
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-4">
      {surfaces.map(({ key, title, description }) => {
        const surface = state.policy[key];
        const thresholdNumber = Number(surface.thresholdPercent) || 0;
        return (
          <fieldset
            key={key}
            className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4"
          >
            <legend className="px-1 text-sm font-medium">{title}</legend>
            <p className="text-xs text-[color:var(--color-muted)]">{description}</p>

            <label className={labelCls}>
              <span className="font-medium">Modo</span>
              <select
                value={surface.mode}
                onChange={(e) => setSurfaceMode(key, e.target.value as CapacityDisplayMode)}
                className={inputCls}
                aria-label={`Modo de exibição para ${title}`}
              >
                {modeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelCls}>
              <span className="font-medium">Limite percentual (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={surface.thresholdPercent}
                disabled={surface.mode !== 'percentage_threshold'}
                onChange={(e) => setSurfaceThreshold(key, e.target.value)}
                className={inputCls}
                aria-label={`Limite percentual para ${title}`}
              />
              <span className="text-xs text-[color:var(--color-muted)]">
                Só mostra a porcentagem quando o estoque restante for igual ou abaixo deste limite.
              </span>
            </label>

            <div className="mt-1 flex flex-col gap-1 rounded bg-[color:var(--color-bg)] p-3 text-xs">
              <span className="font-medium">Pré-visualização</span>
              <span>
                Estoque saudável (8/10):{' '}
                {previewLabel(key, surface.mode, thresholdNumber, 8, 10, 'available')}
              </span>
              <span>
                Estoque baixo (1/10):{' '}
                {previewLabel(key, surface.mode, thresholdNumber, 1, 10, 'available')}
              </span>
              <span>
                Esgotado: {previewLabel(key, surface.mode, thresholdNumber, 0, 10, 'sold_out')}
              </span>
            </div>
          </fieldset>
        );
      })}

      <fieldset className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">Garagem</legend>
        <p className="text-xs text-[color:var(--color-muted)]">
          Quantas vagas grátis cada usuário recebe ao se cadastrar. Marque &quot;Ilimitado&quot;
          para desativar o limite.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.defaultFreeGarageSpots.unlimited}
            onChange={(ev) => setGarageUnlimited(ev.target.checked)}
            disabled={isPending}
            aria-label="Vagas de garagem grátis ilimitadas"
          />
          <span>Ilimitado</span>
        </label>

        <label className={labelCls}>
          <span className="font-medium">Vagas grátis por usuário</span>
          <input
            type="number"
            min={0}
            step={1}
            value={state.defaultFreeGarageSpots.value}
            disabled={state.defaultFreeGarageSpots.unlimited || isPending}
            onChange={(ev) => setGarageValue(ev.target.value)}
            className={inputCls}
            aria-label="Vagas grátis por usuário"
          />
          <span className="text-xs text-[color:var(--color-muted)]">
            A reconciliação por usuário ocorre no próximo acesso à garagem.
          </span>
          {!state.defaultFreeGarageSpots.unlimited &&
          Number.isInteger(Number(state.defaultFreeGarageSpots.value)) &&
          Number(state.defaultFreeGarageSpots.value) <
            (savedGarageSpots ?? Number.POSITIVE_INFINITY) ? (
            <span className="text-xs text-amber-600" role="alert">
              Reduzir o limite remove vagas grátis vazias dos usuários ativos no próximo acesso.
            </span>
          ) : null}
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-green-500">
          {success}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {isPending ? 'Salvando...' : 'Salvar'}
        </button>
        <span className="text-xs text-[color:var(--color-muted)]">
          Última atualização: {new Date(updatedAt).toLocaleString('pt-BR')}
        </span>
      </div>

      <p className="text-xs text-[color:var(--color-muted)]">
        Estados de esgotado e indisponível continuam visíveis em todos os modos.
      </p>
    </form>
  );
}
