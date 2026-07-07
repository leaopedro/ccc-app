import React from 'react';

const COPY = {
  title: 'Produto virtual',
  body: 'Produto virtual — sem estoque ou entrega.',
  detail:
    'Esse SKU é entregue automaticamente após a confirmação do pagamento (webhook). Ele não pode ser arquivado pela interface.',
} as const;

export const VirtualProductBanner = ({ productTypeName }: { productTypeName?: string }) => (
  <aside
    data-testid="virtual-product-banner"
    className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm"
    role="note"
  >
    <p className="font-semibold">{COPY.title}</p>
    <p className="text-[color:var(--color-muted)]">{COPY.body}</p>
    <p className="mt-1 text-xs text-[color:var(--color-muted)]">{COPY.detail}</p>
    {productTypeName ? (
      <p className="mt-2 text-xs text-[color:var(--color-muted)]">
        Tipo vinculado: <span className="font-mono">{productTypeName}</span>
      </p>
    ) : null}
  </aside>
);
