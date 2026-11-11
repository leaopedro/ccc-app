import type { PresaleCampaign } from '@ccc/shared/presale';

import { HeroImage } from './HeroImage';

import { presaleCopy } from '~/copy/presale';

type Props = {
  campaign: PresaleCampaign;
};

/**
 * Seção 1 da página (Task 14). Componente de apresentação: sem estado
 * próprio, renderizável em `environment: 'node'` via renderToStaticMarkup.
 * A imagem em si (que pode não existir em disco ainda) mora em HeroImage,
 * o único pedaço que precisa de cliente.
 */
export function Hero({ campaign }: Props) {
  const copy = presaleCopy.hero;

  return (
    <section className="flex flex-col gap-6">
      {/* Fundo com tom de acento aplicado mesmo sem a foto — é o que faz a
          seção "degradar sem buraco" quando o arquivo não existe. */}
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface-alt to-surface-deep">
        <HeroImage src="/casa-in-box-hero.webp" alt={copy.photoAlt} />
      </div>
      <p className="text-xs text-muted">{copy.photoCaption}</p>

      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-wide text-accent uppercase">{copy.eyebrow}</p>
        <h1 className="font-display text-4xl font-light text-fg sm:text-5xl">{copy.title}</h1>
        <p className="max-w-xl text-base text-fg-secondary">{copy.subtitle}</p>
        {campaign.firstBatchLabel ? (
          <p className="text-sm text-muted">{copy.firstBatchLabel(campaign.firstBatchLabel)}</p>
        ) : null}
        <a
          href="#tiers"
          className="mt-2 inline-flex w-fit items-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-bg"
        >
          {copy.cta}
        </a>
      </div>
    </section>
  );
}
