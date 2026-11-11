import type { PresaleCampaign } from '@ccc/shared/presale';

import { visibleFaqItems } from './selection';

import { presaleCopy } from '~/copy/presale';

type Props = {
  campaign: PresaleCampaign;
};

/**
 * Seção 6 da página (Task 14). Omite a pergunta cujo dado comercial
 * correspondente está vazio na campanha — ver `visibleFaqItems`.
 */
export function Faq({ campaign }: Props) {
  const copy = presaleCopy.faq;
  const items = visibleFaqItems(copy.items, campaign);

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{copy.title}</h2>
      <dl className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.question} className="rounded-2xl border border-border bg-surface p-4">
            <dt className="text-sm font-semibold text-fg">{item.question}</dt>
            <dd className="mt-1 text-sm text-fg-secondary">{item.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
