# Admin do conteúdo institucional da Início

Data: 2026-09-09
Status: revisado após review adversarial, pronto para plano

## Problema

`HomeContent` é uma linha única no Postgres com o texto institucional da tela
de Início: `heroTitle`, `heroSubtitle`, `heroBannerObjectKey`,
`institutionalTitle`, `institutionalBody`, `institutionalImageObjectKey`.

`GET /api/home-content` já serve esse conteúdo, sem cache e sem auth, e o
mobile já o consome. O que não existe é qualquer forma de editar: não há rota
`admin/home-content` nem tela no admin. O conteúdo é seedado e depois imutável
na prática, e trocar o mote da home hoje exige migration ou SQL na mão.

## Escopo

Dentro:

- Editar os quatro campos de texto de `HomeContent`.
- Trocar e remover as duas imagens (banner do hero, imagem institucional).
- Tela no admin, entrada no menu, rota admin na API, auditoria.

Fora, e deliberadamente:

- `HomeBenefit` e `HomeHighlight` (CRUD com ordem, ícone, link, ativo).
- Planos da home. Já têm superfície própria em Premium.
- Rótulos fixos de `apps/mobile/src/copy/inicio.ts`. São bundle, não banco.
- Deletar do R2 o objeto substituído.
- Extrair ou alterar `box-image-uploader.tsx` (ver Decisões).
- Cobrir `/configuracoes` no matcher de `apps/admin/middleware.ts`. A rota
  inteira já está de fora hoje; fechar isso é trabalho próprio.

## Decisões

**Nenhuma migration.** As seis colunas já existem com os tipos e limites certos
(`schema.prisma:2081-2090`). `AdminAudit.action` e `.entityType` são
`VarChar(40)`, não enums do Postgres, então os valores novos não pedem migration
tampouco. `resetDatabase` já trunca `homeContent` (`apps/api/test/helpers.ts:130`).

**Seed não reverte edição.** Verificado: `packages/db/prisma/seed.ts:761-765` faz
`homeContent.upsert` com `update: {}`, e o seed não roda em nenhum caminho de
deploy (`railway.json:8` é só `prisma migrate deploy`; o `CMD` do Dockerfile não
seeda). O hook de seed do Prisma só dispara em `migrate dev` e `migrate reset`.

**Object key validado por prefixo, não só por tamanho.** O `PUT` rejeita com 400
qualquer key não nula que não passe em `app.uploads.isKindKey(key, 'home_media')`.
Sem isso um organizer escreve `feed_photo/<outro-usuário>/x.jpg` ou
`support_attachment/<vítima>/x.jpg` no banner, e `home-content.ts:88-89` resolve
com `buildPublicUrl` e publica na primeira tela do app, sem auth. É a mesma
guarda que `box-catalog-admin.ts:52` e `box-partners-admin.ts:68` já aplicam.
`isKindKey` e não `isOwnedKey`: o presign carimba o id de quem subiu
(`r2.ts:58`), então ownership quebraria um segundo organizer resalvando o form.

Em produção uma key de `identity-document` cairia em bucket separado e daria 404,
porque `buildPublicUrl` concatena contra o bucket público. Mas isso é acidente
feliz, não defesa: `buildPublicUrl` (`r2.ts:102-104`) é o único método que não
roteia por prefixo, e sob `DevUploads` o namespace é único (`dev.ts:47`), então em
dev e preview o vazamento é real.

**Um `UploadKind` interno, não público.** `home_media` entra no union `UploadKind`
(`apps/api/src/services/uploads/types.ts:1`) e no `UPLOAD_KIND_PATH_PREFIX` com
prefixo `home-media`. Não entra no `UPLOAD_KINDS` de
`packages/shared/src/uploads.ts`: aquela lista é alcançável por qualquer usuário
autenticado via `POST /uploads/presign`. Mesma razão de `garage_cover` e
`identity_document` ficarem de fora dela. `UPLOAD_KIND_PATH_PREFIX` é o único
`Record<UploadKind, …>` exaustivo do repo, então é uma linha em um arquivo.

**Sem `slot` no presign.** Com um kind só, a coluna é escolhida pelo campo do
`PUT` e o path vem do kind (`r2.ts:57`). Um `slot` no request seria campo
obrigatório que o servidor ignora.

**Campos opcionais coagem vazio para nulo.** O input do form entrega `""`, nunca
`null`. Com `min(1).nullable()` puro, Remover e limpar subtítulo dariam 400
traduzido como "Dados inválidos", e o organizer nunca conseguiria apagar nada.
Os três campos nuláveis usam o helper `optionalText` que já existe em
`packages/shared/src/admin.ts:176-180`. Os quatro campos de texto levam `.trim()`
antes do `min(1)`: `heroTitle: "   "` passa em `min(1)` nos dois lados e publica
um hero em branco.

**Escrita só do que mudou, com precondição.** O `PUT` compara campo a campo
contra a linha persistida e monta o `data` só com as diferenças, como
`admin/general-settings.ts`. Além disso o cliente devolve o `updatedAt` que
leu, e a escrita vira
`updateMany({ where: { id, updatedAt: expected }, data })`; `count === 0`
responde 409. Sem a precondição, dois organizers com o form aberto se
sobrescrevem de um jeito pior que o normal: como o form envia payload inteiro e
o diff compara contra o banco, o save velho de A **reverte ativamente** a edição
de B e a auditoria credita a reversão ao A.

`updatedAt` numa linha nunca editada é o timestamp do primeiro app launch
anônimo que criou a row (`services/home-content.ts:21`), então a UI não pode
rotular isso como "última edição".

**Não extrair o uploader do Box.** A versão anterior deste spec mandava extrair
`box-image-uploader.tsx` e afirmava que a mudança estaria "coberta pelos testes
de Box existentes". A afirmação era falsa: o componente não tem teste nenhum e
tem seis call sites em produção (`box-catalog-client.tsx:71,164`,
`box-partners-client.tsx:71,122,167,224`). Ele também não serviria os dois casos
sem virar outro componente: box é fluxo de FormData e depende do
`<input type="hidden" name={...}>`, a home é action de objeto tipado e precisa de
callback, o label é a string fixa "Imagem", e não existe afordância de remover.

A home ganha `home-image-uploader.tsx` próprio. Box fica intocado.

**Cap prático no mote.** `heroTitle` limitado a 70 no Zod e no input, embora a
coluna aceite 120. O hero é caixa fixa de 210px com `overflow: 'hidden'`
(`HeroSection.tsx:73-78`), mote em 29/30 com ~306px úteis: 120 caracteres pedem
~7 linhas e o topo do texto é cortado sem aviso. A coluna continua 120 para não
exigir migration se a decisão mudar.

**Sem invalidação de cache.** `GET /api/home-content` foi escrito sem cache em
memória exatamente para conteúdo editável surtir efeito sem republicar o app
(`home-content.ts:9-12`).

## Superfície

### `packages/shared/src/admin-home.ts` (novo)

Arquivo próprio, não `home.ts`. O cabeçalho de `packages/shared/src/home.ts:1-8`
declara aquele módulo "Client-facing ONLY (…) o cliente nunca vê chave de
objeto", e o admin precisa justamente das keys. Mesmo precedente de
`admin-box.ts`.

```
adminHomeContentSchema
  heroTitle, heroSubtitle, heroBannerObjectKey, heroBannerUrl,
  institutionalTitle, institutionalBody,
  institutionalImageObjectKey, institutionalImageUrl,
  updatedAt

homeContentUpdateSchema        // campos de conteúdo opcionais, precondição obrigatória
  heroTitle?           string.trim() 1..70
  heroSubtitle?        optionalText(200)
  heroBannerObjectKey? optionalText(300)
  institutionalTitle?  string.trim() 1..120
  institutionalBody?   string.trim() 1..1000
  institutionalImageObjectKey? optionalText(300)
  expectedUpdatedAt    datetime, obrigatório

adminHomeImagePresignRequestSchema
  contentType: enum(ALLOWED_IMAGE_TYPES)
  size: int 1..MAX_UPLOAD_BYTES
```

Key e URL das duas imagens viajam na leitura: o form precisa da URL para mostrar
o que está no ar e da key para reenviar no save.

### `packages/shared/src/admin.ts`

- `adminAuditActionSchema` ganha `'home_content.update'`.
- `adminAuditEntityTypeSchema` ganha `'home_content'`. Registrar que esse schema
  não é referenciado por nada hoje; a união que o compilador cobra é a de
  `admin-audit.ts`.

### `apps/api/src/services/admin-audit.ts`

`RecordAuditInput['entityType']` ganha `'home_content'`.

### `apps/api/src/routes/admin/home-content.ts` (novo)

Registrado em `admin/index.ts:69`, ao lado de `adminGeneralSettingsRoutes`,
dentro do escopo `requireRole('organizer', 'admin')`. Staff é rejeitado.

- `GET /admin/home/content` — `ensureHomeContent()`, URLs via
  `app.uploads.buildPublicUrl`, serializa por `adminHomeContentSchema`.
- `PUT /admin/home/content` — parse; rejeita 400 se alguma key não nula falhar
  em `isKindKey(key, 'home_media')`; diff contra a linha existente;
  `updateMany` com precondição de `updatedAt`, 409 se `count === 0`;
  `recordAudit({ action: 'home_content.update', entityType: 'home_content',
entityId: HOME_CONTENT_SINGLETON_ID, metadata: { fields, images: { previous,
next } } })`. Nenhum campo tocado significa nenhum write e nenhuma auditoria.

  A metadata carrega o antes e depois das duas keys de imagem, não só os nomes
  dos campos. O `entityId` é um singleton que o próximo save sobrescreve, então
  só os nomes não respondem "quem pôs aquela imagem na home e o que havia antes".
  Precedente: `garage.ts:335-341` faz isso para a capa de garagem, que é bem
  menos exposta. Texto fica de fora da metadata: `institutionalBody` tem 1000
  caracteres.

- `POST /admin/home/images/presign` — `kind: 'home_media'` injetado no servidor,
  nunca no body. Resposta é `presignResponseSchema` com `expiresAt` via
  `.toISOString()`, igual `garage.ts:275`, para o uploader ter uma forma só.

  O rate limit fica num `app.register` interno **dentro deste arquivo**,
  envolvendo só o presign, com `hook: 'preHandler'` e
  `keyGenerator: 'home-media-presign:${sub}'`. O bloco compartilhado de
  `index.ts:59-85` registra 25 plugins e não pode receber limiter. E sem
  `hook: 'preHandler'` o limiter roda em `onRequest`, antes de `request.user`
  existir, e cai silenciosamente para balde por IP: o mesmo bug está comentado
  em `me-documents.ts:49-51` e `admin/index.ts:124-127`.

### Admin

`/configuracoes` não tem link em lugar nenhum hoje: `ORGANIZER_LINKS`
(`authed-nav.tsx:11-22`) não lista Configurações e um grep por `/configuracoes`
em `apps/admin` não acha href nenhum. A rota é órfã. Entra
`{ href: '/configuracoes', label: 'Configurações' }` em `ORGANIZER_LINKS`, com
`authed-nav.test.tsx` atualizado.

Abas seguem a convenção real do repo, que é `layout.tsx` e não import por page
(`loja/layout.tsx:1-9` renderiza `StoreSectionTabs` uma vez):

- `configuracoes/layout.tsx` — renderiza `SettingsTabs` e concentra o bloqueio de
  staff. Hoje esse bloqueio mora em `configuracoes/page.tsx:10-22`; se ficasse lá
  o "Acesso restrito" apareceria embaixo da barra de abas. A page perde a checagem
  e o layout passa a fazê-la para as duas rotas.
- `/configuracoes` — Gerais, o form atual
- `/configuracoes/home` — Home

Arquivos:

- `configuracoes/layout.tsx`
- `configuracoes/settings-tabs.tsx`
- `configuracoes/home/page.tsx` — server, com `export const dynamic = 'force-dynamic'`
  (convenção da casa: `configuracoes/page.tsx:6`, `auditoria/page.tsx:5`)
- `configuracoes/home-content-form.tsx` — client
- `apps/admin/src/components/home-image-uploader.tsx`
- `apps/admin/src/lib/home-content-actions.ts` — `presignHomeImageAction(input:
{ contentType, size })`, sem parâmetro `kind`, para o cliente não conseguir
  apontar o presign para outra categoria nem pela assinatura da action
- Dois wrappers em `apps/admin/src/lib/admin-api.ts`

O form: quatro campos com `maxLength` e contador, dois slots com Remover,
Salvar, estados de erro e sucesso, e tratamento explícito do 409 ("alguém editou
enquanto você escrevia, recarregue").

O objeto substituído fica órfão no R2. Não há delete no save: trocar banner é
raro, o arquivo é pequeno, e apagar no save arrisca remover objeto ainda
referenciado. Limpeza de órfãos é trabalho separado.

## Testes

API, contra Postgres real (Testcontainers), como o CLAUDE.md exige:

- Round trip: `PUT` no admin e o conteúdo aparece em `GET /api/home-content`,
  com `bannerUrl` resolvida a partir da key. Nenhum outro teste desta lista
  chega a popular uma key de imagem, porque a linha auto-criada nasce com as
  duas nulas.
- `GET /admin/home/content` devolve a linha, criando-a quando não existe.
- `PUT` altera só os campos enviados.
- `PUT` idêntico ao persistido não audita **e não mexe em `updatedAt`**. A
  asserção é sobre `updatedAt`, não sobre contagem de auditoria: só contar
  auditoria passa verde enquanto todo Salvar bumpa a linha, que é exatamente a
  regressão que a decisão de diff existe para evitar. Precedente:
  `apps/api/test/admin/general-settings.test.ts`.
- `PUT` com mudança grava auditoria com os campos tocados e o antes/depois das
  keys.
- `PUT` com `expectedUpdatedAt` velho responde 409 e não escreve.
- `heroBannerObjectKey: 'identity-document/<uid>/x.jpg'` responde 400.
  Idem `feed_photo/...`.
- `""` em `heroSubtitle` e nas duas keys limpa a coluna, não dá 400.
- `heroTitle: '   '` responde 400.
- Texto acima do limite responde 400, não erro de Prisma.
- 401 sem auth, 403 para staff e para `user` comum, nos três endpoints.
- Presign rejeita `contentType` e `size` fora da faixa e responde
  `presignResponseSchema`.
- Presign: dois usuários no mesmo IP não dividem quota, no molde de
  `apps/api/test/rate-limit-gaps.test.ts:127`. É o que prova o `hook:
'preHandler'`; sem isso o limiter cai para IP em silêncio.

Não vale a pena testar "presign ignora `kind` do cliente": o Zod remove chave
desconhecida por padrão, então o teste passa em qualquer implementação que faça
parse do body.

Admin:

- Teste de interação do form, no molde de
  `general-settings-form.interaction.test.tsx`: edita e salva, mostra erro do
  servidor, remove imagem e o save resultante manda `null`, e o 409 mostra a
  mensagem de recarregar.

## Riscos

- Texto institucional é conteúdo público. Quem tem `organizer` passa a poder
  publicar na primeira tela do app sem revisão. Mesma exposição que `organizer`
  já tem em eventos e loja.
- Fora deste escopo, mas anotado: `/configuracoes` não está no matcher de
  `apps/admin/middleware.ts:5-18`, então a rota depende só do `readRole()` do
  server component. O cookie `session_role` é `httpOnly: false`
  (`auth-session.ts:26`) e forjável, então a fronteira real é o `requireRole` da
  API, que este spec usa. Pré-existente para a rota inteira.
- Fora deste escopo, mas anotado: `seed.ts:766-787` faz `deleteMany` +
  `createMany` incondicional em `HomeBenefit` e `HomeHighlight`. Rodar o seed à
  mão contra prod apaga curadoria feita no banco. Relevante para o projeto
  adiado de CRUD desses dois, não para este.
