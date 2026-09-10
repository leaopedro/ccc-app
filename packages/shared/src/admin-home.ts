// Schemas do admin para HomeContent. Mora fora de ./home.ts de proposito:
// aquele modulo se declara client-facing e promete que o cliente nunca ve
// chave de objeto, e o form do admin precisa justamente das keys para
// reenviar no save. Mesmo precedente de ./admin-box.ts.

import { z } from 'zod';

import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from './uploads.js';

/**
 * Cap do mote. A coluna aceita 120, mas o hero e uma caixa fixa de 210px com
 * overflow hidden (apps/mobile/src/screens/inicio/sections/HeroSection.tsx),
 * mote em 29/30 com ~306px uteis: acima de ~70 caracteres o topo do texto e
 * cortado sem aviso. A coluna fica em 120 para nao exigir migration se a
 * decisao mudar.
 */
export const HERO_TITLE_MAX = 70;

/** Prefixo R2 das imagens da home. Espelha UPLOAD_KIND_PATH_PREFIX.home_media. */
export const HOME_MEDIA_OBJECT_KEY_PREFIX = 'home-media';

/**
 * Forma estrutural da object key das imagens da home. `isKindKey` compara
 * so o prefixo, entao `home-media/../feed_photo/x.jpg` passaria por ele e o
 * CDN normalizaria o `..` para a foto de outro membro, na primeira tela do
 * app e sem auth. Os segmentos `[a-z0-9]+` e `[^/]+` recusam travessia.
 * Mesmo precedente de garageCoverObjectKeyRe em ./garage.ts.
 */
export const HOME_MEDIA_OBJECT_KEY_RE = /^home-media\/[a-z0-9]+\/[^/]+$/i;

/**
 * Campos nulaveis coagem vazio para null: o input do form entrega '' e nunca
 * null, entao um .min(1).nullable() puro tornaria o botao Remover inalcancavel.
 * Mesmo idiom do optionalText de ./admin.ts, redeclarado local porque la ele
 * nao e exportado.
 */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().min(1).max(max).nullable(),
  );

export const adminHomeContentSchema = z.object({
  heroTitle: z.string().min(1),
  heroSubtitle: z.string().nullable(),
  heroBannerObjectKey: z.string().nullable(),
  heroBannerUrl: z.string().url().nullable(),
  institutionalTitle: z.string().min(1),
  institutionalBody: z.string().min(1),
  institutionalImageObjectKey: z.string().nullable(),
  institutionalImageUrl: z.string().url().nullable(),
  updatedAt: z.string().datetime(),
});
export type AdminHomeContent = z.infer<typeof adminHomeContentSchema>;

export const homeContentUpdateSchema = z.object({
  // Precondicao de escrita, nao conteudo. O cliente devolve o updatedAt que
  // leu; o handler responde 409 se a linha mudou nesse meio tempo.
  expectedUpdatedAt: z.string().datetime(),
  heroTitle: z.string().trim().min(1).max(HERO_TITLE_MAX).optional(),
  heroSubtitle: optionalText(200).optional(),
  heroBannerObjectKey: optionalText(300).optional(),
  institutionalTitle: z.string().trim().min(1).max(120).optional(),
  institutionalBody: z.string().trim().min(1).max(1000).optional(),
  institutionalImageObjectKey: optionalText(300).optional(),
});
export type HomeContentUpdate = z.infer<typeof homeContentUpdateSchema>;

export const adminHomeImagePresignRequestSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type AdminHomeImagePresignRequest = z.infer<typeof adminHomeImagePresignRequestSchema>;
