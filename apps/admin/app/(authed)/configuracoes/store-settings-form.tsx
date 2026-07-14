'use client';

import type { StoreSettings } from '@ccc/shared/store';
import { useState, useTransition } from 'react';

import { brand } from '~/brand';
import { updateAdminStoreSettingsAction } from '~/lib/store-settings-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

const labelCls = 'flex flex-col gap-1 text-sm';

export function StoreSettingsForm({ initial }: { initial: StoreSettings }) {
  const [storeEnabled, setStoreEnabled] = useState(initial.storeEnabled);
  const [eventPickupEnabled, setEventPickupEnabled] = useState(initial.eventPickupEnabled);
  const [shippingFee, setShippingFee] = useState(String(initial.defaultShippingFeeCents));
  const [lowStock, setLowStock] = useState(String(initial.lowStockThreshold));
  const [storeHeaderTitle, setStoreHeaderTitle] = useState(initial.storeHeaderTitle ?? '');
  const [storeHeaderSubtitle, setStoreHeaderSubtitle] = useState(initial.storeHeaderSubtitle ?? '');
  const [pickup, setPickup] = useState(initial.pickupDisplayLabel ?? '');
  const [phone, setPhone] = useState(initial.supportPhone ?? '');
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const shippingCents = Number(shippingFee);
    if (!Number.isInteger(shippingCents) || shippingCents < 0) {
      setError('Frete padrão deve ser um inteiro em centavos maior ou igual a zero.');
      return;
    }

    const lowStockNumber = Number(lowStock);
    if (!Number.isInteger(lowStockNumber) || lowStockNumber < 0) {
      setError('Limite de estoque baixo deve ser um inteiro maior ou igual a zero.');
      return;
    }

    const pickupTrimmed = pickup.trim();
    const phoneTrimmed = phone.trim();
    const titleTrimmed = storeHeaderTitle.trim();
    const subtitleTrimmed = storeHeaderSubtitle.trim();

    startTransition(async () => {
      const result = await updateAdminStoreSettingsAction({
        storeEnabled,
        eventPickupEnabled,
        defaultShippingFeeCents: shippingCents,
        lowStockThreshold: lowStockNumber,
        storeHeaderTitle: titleTrimmed === '' ? null : titleTrimmed,
        storeHeaderSubtitle: subtitleTrimmed === '' ? null : subtitleTrimmed,
        pickupDisplayLabel: pickupTrimmed === '' ? null : pickupTrimmed,
        supportPhone: phoneTrimmed === '' ? null : phoneTrimmed,
      });
      if (result.ok) {
        setStoreEnabled(result.settings.storeEnabled);
        setEventPickupEnabled(result.settings.eventPickupEnabled);
        setShippingFee(String(result.settings.defaultShippingFeeCents));
        setLowStock(String(result.settings.lowStockThreshold));
        setStoreHeaderTitle(result.settings.storeHeaderTitle ?? '');
        setStoreHeaderSubtitle(result.settings.storeHeaderSubtitle ?? '');
        setPickup(result.settings.pickupDisplayLabel ?? '');
        setPhone(result.settings.supportPhone ?? '');
        setUpdatedAt(result.settings.updatedAt);
        setSuccess('Configurações salvas.');
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
      <label className="flex items-start gap-3 rounded border border-[color:var(--color-border)] p-3 text-sm">
        <input
          type="checkbox"
          checked={storeEnabled}
          onChange={(e) => setStoreEnabled(e.target.checked)}
          className="mt-0.5"
          aria-label="Loja pública habilitada"
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">Loja pública habilitada</span>
          <span className="text-xs text-[color:var(--color-muted)]">
            Desative para bloquear novas compras e navegação pública da loja sem esconder pedidos já
            existentes.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded border border-[color:var(--color-border)] p-3 text-sm">
        <input
          type="checkbox"
          checked={eventPickupEnabled}
          onChange={(e) => setEventPickupEnabled(e.target.checked)}
          className="mt-0.5"
          aria-label="Retirada no evento habilitada"
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">Retirada no evento habilitada</span>
          <span className="text-xs text-[color:var(--color-muted)]">
            Permite que clientes escolham retirar produtos em eventos. Cada produto ainda precisa
            ter a retirada habilitada individualmente.
          </span>
        </span>
      </label>

      <label className={labelCls}>
        <span className="font-medium">Frete padrão (centavos)</span>
        <input
          type="number"
          min={0}
          step={1}
          value={shippingFee}
          onChange={(e) => setShippingFee(e.target.value)}
          className={inputCls}
          aria-label="Frete padrão em centavos"
        />
        <span className="text-xs text-[color:var(--color-muted)]">
          Valor sugerido para envios físicos quando não houver tabela específica.
        </span>
      </label>

      <label className={labelCls}>
        <span className="font-medium">Limite de estoque baixo</span>
        <input
          type="number"
          min={0}
          step={1}
          value={lowStock}
          onChange={(e) => setLowStock(e.target.value)}
          className={inputCls}
          aria-label="Limite de estoque baixo"
        />
        <span className="text-xs text-[color:var(--color-muted)]">
          Variantes com estoque igual ou abaixo deste limite são destacadas no painel.
        </span>
      </label>

      <label className={labelCls}>
        <span className="font-medium">Título do topo da loja (mobile)</span>
        <input
          type="text"
          maxLength={140}
          value={storeHeaderTitle}
          onChange={(e) => setStoreHeaderTitle(e.target.value)}
          className={inputCls}
          placeholder="Ex.: Drop novo. Corre antes que acabe."
        />
        <span className="text-xs text-[color:var(--color-muted)]">
          Quando preenchido, substitui o título padrão do hero da loja no app.
        </span>
      </label>

      <label className={labelCls}>
        <span className="font-medium">Subtítulo do topo da loja (mobile)</span>
        <input
          type="text"
          maxLength={240}
          value={storeHeaderSubtitle}
          onChange={(e) => setStoreHeaderSubtitle(e.target.value)}
          className={inputCls}
          placeholder={`Ex.: Itens oficiais do ${brand.name} com estoque limitado.`}
        />
        <span className="text-xs text-[color:var(--color-muted)]">
          Quando preenchido, substitui o subtítulo padrão do hero da loja no app.
        </span>
      </label>

      <label className={labelCls}>
        <span className="font-medium">Texto da retirada local</span>
        <input
          type="text"
          maxLength={140}
          value={pickup}
          onChange={(e) => setPickup(e.target.value)}
          className={inputCls}
          placeholder={`Ex.: Retirada na sede do ${brand.shortName}, das 10h às 18h`}
        />
      </label>

      <label className={labelCls}>
        <span className="font-medium">Telefone de suporte</span>
        <input
          type="text"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputCls}
          placeholder="(11) 99999-0000"
        />
      </label>

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
    </form>
  );
}
