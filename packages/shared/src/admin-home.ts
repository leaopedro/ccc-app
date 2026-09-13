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
 * app e sem auth. `[^/]+` no ultimo segmento admite `%2f` codificado, que o
 * router decodifica antes do path ser resolvido, entao "sem barra" nao
 * bloqueia a travessia. Os segmentos sao por isso enumerados pelo formato
 * exato que presignPut emite: userId (cuid do Prisma) e createId() (cuid2)
 * sao ambos alfanumerico minusculo, e EXT_FOR_MIME so produz jpg/png/webp.
 * Mesmo precedente de garageCoverObjectKeyRe em ./garage.ts.
 */
export const HOME_MEDIA_OBJECT_KEY_RE = /^home-media\/[a-z0-9]+\/[a-z0-9]+\.(jpg|png|webp)$/;

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
  /**
   * `.default(5)` na LEITURA: a API roda no Railway e o admin na Vercel, com
   * deploys independentes. Sem o default, um deploy do admin que chegue antes
   * do da API faz este parse lançar a página inteira de configurações.
   */
  feedPostCount: z.number().int().min(0).default(5),
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
  /**
   * Quantos posts a seção de feed da Início sorteia. Zero desliga a seção. O
   * teto de 20 é de produto, não de banco: a Início é uma tela de resumo.
   *
   * O preprocess é load-bearing, no mesmo espírito do optionalText acima. O
   * input do form entrega '' e nunca undefined; `z.coerce.number()` puro faz
   * Number('') === 0, que passa em min(0) e DESLIGA a seção. Vazio tem que
   * significar "não alterar".
   */
  feedPostCount: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().min(0).max(20).optional(),
  ),
});
export type HomeContentUpdate = z.infer<typeof homeContentUpdateSchema>;

export const adminHomeImagePresignRequestSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type AdminHomeImagePresignRequest = z.infer<typeof adminHomeImagePresignRequestSchema>;
