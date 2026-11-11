'use client';

import { useState } from 'react';

type Props = {
  src: string;
  alt: string;
};

/**
 * A foto do Hero ainda não chegou ao disco (Task 14: "slot sim, binário
 * não") — o `src` abaixo aponta para `apps/garage/public/casa-in-box-hero.webp`,
 * que pode não existir. Em vez de quebrar o layout com o ícone de imagem
 * quebrada do navegador, o `onError` esconde a tag e o contêiner (Hero.tsx)
 * degrada para o próprio fundo. Único pedaço desta feature que precisa de
 * `'use client'`: o resto do Hero é estático e server-renderizável.
 */
export function HeroImage({ src, alt }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
