'use client';

import { HERO_TITLE_MAX, type AdminHomeContent } from '@ccc/shared/admin-home';
import { useState, useTransition } from 'react';

import { HomeImageUploader } from '~/components/home-image-uploader';
import { updateAdminHomeContentAction } from '~/lib/home-content-actions';

const labelCls = 'flex flex-col gap-1 text-sm';
const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

type ImageState = { objectKey: string | null; previewUrl: string | null };

export const HomeContentForm = ({ initial }: { initial: AdminHomeContent }) => {
  const [content, setContent] = useState(initial);
  const [heroTitle, setHeroTitle] = useState(initial.heroTitle);
  const [heroSubtitle, setHeroSubtitle] = useState(initial.heroSubtitle ?? '');
  const [institutionalTitle, setInstitutionalTitle] = useState(initial.institutionalTitle);
  const [institutionalBody, setInstitutionalBody] = useState(initial.institutionalBody);
  const [banner, setBanner] = useState<ImageState>({
    objectKey: initial.heroBannerObjectKey,
    previewUrl: initial.heroBannerUrl,
  });
  const [institutionalImage, setInstitutionalImage] = useState<ImageState>({
    objectKey: initial.institutionalImageObjectKey,
    previewUrl: initial.institutionalImageUrl,
  });
  const [feedPostCount, setFeedPostCount] = useState(String(initial.feedPostCount));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      // String vazia, e nao null: o schema coage vazio para null no servidor, e
      // o form nunca precisa distinguir "nao mexi" de "apaguei" porque sempre
      // envia o payload inteiro. O diff do handler resolve o resto.
      const result = await updateAdminHomeContentAction({
        expectedUpdatedAt: content.updatedAt,
        heroTitle,
        heroSubtitle,
        heroBannerObjectKey: banner.objectKey ?? '',
        institutionalTitle,
        institutionalBody,
        institutionalImageObjectKey: institutionalImage.objectKey ?? '',
        // Omitir quando vazio, em vez de mandar '' ou NaN. HomeContentUpdate
        // e o tipo de SAIDA do zod, entao feedPostCount e `number | undefined`
        // e passar a string crua nao compila. Campo vazio significa "nao
        // alterar", e omitir e exatamente isso.
        ...(feedPostCount.trim() === '' ? {} : { feedPostCount: Number(feedPostCount) }),
      });

      if (result.ok) {
        setContent(result.content);
        setBanner({
          objectKey: result.content.heroBannerObjectKey,
          previewUrl: result.content.heroBannerUrl,
        });
        setInstitutionalImage({
          objectKey: result.content.institutionalImageObjectKey,
          previewUrl: result.content.institutionalImageUrl,
        });
        setFeedPostCount(String(result.content.feedPostCount));
        setMessage({ kind: 'ok', text: 'Conteúdo salvo.' });
        return;
      }
      setMessage({ kind: 'error', text: result.error });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Hero</h2>
        <label className={labelCls}>
          <span>
            Mote do hero ({heroTitle.length}/{HERO_TITLE_MAX})
          </span>
          <input
            className={inputCls}
            aria-label="Mote do hero"
            maxLength={HERO_TITLE_MAX}
            value={heroTitle}
            onChange={(e) => setHeroTitle(e.target.value)}
          />
        </label>
        <label className={labelCls}>
          <span>Subtítulo ({heroSubtitle.length}/200)</span>
          <input
            className={inputCls}
            aria-label="Subtítulo do hero"
            maxLength={200}
            value={heroSubtitle}
            onChange={(e) => setHeroSubtitle(e.target.value)}
          />
        </label>
        <HomeImageUploader
          label="Banner do hero"
          removeLabel="Remover banner do hero"
          objectKey={banner.objectKey}
          previewUrl={banner.previewUrl}
          onChange={setBanner}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Institucional</h2>
        <label className={labelCls}>
          <span>Título ({institutionalTitle.length}/120)</span>
          <input
            className={inputCls}
            aria-label="Título institucional"
            maxLength={120}
            value={institutionalTitle}
            onChange={(e) => setInstitutionalTitle(e.target.value)}
          />
        </label>
        <label className={labelCls}>
          <span>Texto ({institutionalBody.length}/1000)</span>
          <textarea
            className={`${inputCls} min-h-32`}
            aria-label="Texto institucional"
            maxLength={1000}
            value={institutionalBody}
            onChange={(e) => setInstitutionalBody(e.target.value)}
          />
        </label>
        <HomeImageUploader
          label="Imagem institucional"
          removeLabel="Remover imagem institucional"
          objectKey={institutionalImage.objectKey}
          previewUrl={institutionalImage.previewUrl}
          onChange={setInstitutionalImage}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Feed da comunidade</h2>
        <label className={labelCls}>
          <span>Posts no feed da Início (0 a 20, zero esconde a seção)</span>
          <input
            className={inputCls}
            aria-label="Posts no feed da Início"
            type="number"
            min={0}
            max={20}
            value={feedPostCount}
            onChange={(e) => setFeedPostCount(e.target.value)}
          />
        </label>
        <p className="text-xs opacity-70">
          Só entram posts de eventos publicados e com o feed marcado como público.
        </p>
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
