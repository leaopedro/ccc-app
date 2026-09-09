# Admin do conteúdo institucional da Início

Data: 2026-09-09
Status: aprovado, pronto para plano

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
- Tela no admin, rota admin na API, auditoria.

Fora, e deliberadamente:

- `HomeBenefit` e `HomeHighlight` (CRUD com ordem, ícone, link, ativo). Continuam
  sem tela.
- Planos da home. Já têm superfície própria em Premium.
- Rótulos fixos de `apps/mobile/src/copy/inicio.ts`. São bundle, não banco; mesmo
  tipo de trabalho do projeto irmão de copy de gamificação.
- Deletar do R2 o objeto substituído.

## Decisões

**Nenhuma migration de dados.** As seis colunas já existem com os tipos e limites
certos. O projeto é só superfície. As únicas mudanças de tipo são duas adições a
uniões de auditoria (ver abaixo).

**Um `UploadKind` interno, não público.** `home_media` entra no union
`UploadKind` de `apps/api/src/services/uploads/types.ts` e no
`UPLOAD_KIND_PATH_PREFIX` com prefixo `home-media`. Não entra no `UPLOAD_KINDS`
de `packages/shared/src/uploads.ts`: aquela lista é alcançável por qualquer
usuário autenticado via `POST /uploads/presign`, então incluir o banner da home
ali deixaria qualquer membro do app escrever no prefixo do marketing. Mesma razão
pela qual `garage_cover` e `identity_document` ficam de fora dela.

Um kind só cobre os dois slots. O `slot` do request decide qual coluna recebe a
key, não onde o arquivo cai no bucket.

**Escrita só do que mudou.** O `PUT` compara campo a campo contra a linha
persistida e monta o `data` do Prisma apenas com as diferenças. Sem isso, o form
(que sempre envia o payload inteiro) gravaria uma linha de auditoria e bumparia
`updatedAt` a cada clique em Salvar. É o mesmo idiom de
`apps/api/src/routes/admin/general-settings.ts`.

**Limites de tamanho no Zod, não só no input.** `heroTitle` 120, `heroSubtitle`
200, `institutionalTitle` 120, `institutionalBody` 1000, object keys 300. Os
números espelham o `@db.VarChar` do schema. Sem o Zod, um request fora do form
fura o `maxLength` do HTML e o erro vira falha de escrita do Prisma em vez de um
400 com mensagem.

**Sem invalidação de cache.** `GET /api/home-content` foi escrito sem cache em
memória exatamente para conteúdo editável surtir efeito sem republicar o app. A
edição aparece no próximo fetch da tela. Nada a invalidar.

## Superfície

### `packages/shared/src/home.ts`

```
adminHomeContentSchema      // leitura do admin
  heroTitle: string
  heroSubtitle: string | null
  heroBannerObjectKey: string | null
  heroBannerUrl: string | null
  institutionalTitle: string
  institutionalBody: string
  institutionalImageObjectKey: string | null
  institutionalImageUrl: string | null
  updatedAt: string (datetime)

homeContentUpdateSchema     // partial, todos os campos opcionais
  heroTitle?: string 1..120
  heroSubtitle?: (string 1..200) | null
  heroBannerObjectKey?: (string 1..300) | null
  institutionalTitle?: string 1..120
  institutionalBody?: string 1..1000
  institutionalImageObjectKey?: (string 1..300) | null

adminHomeImagePresignRequestSchema
  slot: 'hero' | 'institutional'
  contentType: enum(ALLOWED_IMAGE_TYPES)
  size: int 1..MAX_UPLOAD_BYTES
```

A leitura carrega key e URL das duas imagens: o form precisa da URL para mostrar
a imagem atual e da key para reenviar no save.

### `packages/shared/src/admin.ts`

- `adminAuditActionSchema` ganha `'home_content.update'`.
- A união de `entityType` ganha `'home_content'`.

### `apps/api/src/services/admin-audit.ts`

`RecordAuditInput['entityType']` ganha `'home_content'`.

### `apps/api/src/routes/admin/home-content.ts` (novo)

Registrado em `admin/index.ts` dentro do escopo
`requireRole('organizer', 'admin')`, o mesmo bloco de `adminGeneralSettingsRoutes`.
Staff é rejeitado.

- `GET /admin/home/content` — `ensureHomeContent()`, resolve as URLs com
  `app.uploads.buildPublicUrl`, serializa por `adminHomeContentSchema`.
- `PUT /admin/home/content` — parse, diff contra a linha existente, update dos
  campos tocados, `recordAudit({ action: 'home_content.update', entityType:
'home_content', entityId: HOME_CONTENT_SINGLETON_ID, metadata: { fields } })`.
  Nenhum campo tocado significa nenhum write e nenhuma linha de auditoria.
  Responde a linha serializada.
- `POST /admin/home/images/presign` — parse do body, `kind: 'home_media'`
  injetado no servidor, `app.uploads.presignPut`. Rate limit no próprio escopo,
  como o presign de capa de garagem faz. O cliente nunca envia `kind`.

### Admin

`/configuracoes` hoje renderiza `GeneralSettingsForm` direto. Passa a ter abas,
no molde de `apps/admin/src/components/store-section-tabs.tsx`:

- `/configuracoes` — Gerais (form atual, intocado)
- `/configuracoes/home` — Home

Arquivos:

- `apps/admin/app/(authed)/configuracoes/settings-tabs.tsx` — abas.
- `apps/admin/app/(authed)/configuracoes/home/page.tsx` — server component. Faz o
  fetch e repete o bloqueio de staff que `configuracoes/page.tsx` já aplica.
- `apps/admin/app/(authed)/configuracoes/home-content-form.tsx` — client. Quatro
  campos com `maxLength` e contador, dois slots de imagem, Salvar, estados de
  erro e sucesso.
- `apps/admin/src/lib/home-content-actions.ts` — server actions, no molde de
  `general-settings-actions.ts`.
- Dois wrappers em `apps/admin/src/lib/admin-api.ts`.

O uploader de imagem sai de `box-image-uploader.tsx` para um componente genérico
reusado pelos dois. A única coisa específica de box nele é o tipo `Kind` e a
action chamada; ambos viram props. Box passa a usar o extraído, sem mudança de
comportamento.

Cada slot ganha um botão Remover que zera a key. O `PUT` aceita `null` nos dois
campos de imagem.

O objeto substituído fica órfão no R2. Não há delete no save: trocar banner é
raro, o arquivo é pequeno, e apagar no save arrisca remover objeto ainda
referenciado por outra linha. Limpeza de órfãos é trabalho separado.

## Testes

API, contra Postgres real (Testcontainers), como o CLAUDE.md exige:

- `GET` devolve a linha, criando-a quando ainda não existe.
- `PUT` altera só os campos enviados e devolve a linha atualizada.
- `PUT` com payload idêntico ao persistido não escreve e não audita.
- `PUT` que muda algo grava uma linha de auditoria com os campos tocados.
- Staff recebe 403 nos três endpoints.
- Body acima do limite de caractere devolve 400, não erro de Prisma.
- `heroSubtitle: null` e `heroBannerObjectKey: null` limpam a coluna.
- Presign rejeita `contentType` e `size` fora da faixa.
- Presign ignora um `kind` enviado pelo cliente e usa `home_media`.

Admin:

- Teste de interação do form, no molde de
  `general-settings-form.interaction.test.tsx`: edita, salva, mostra erro do
  servidor, remove imagem.

## Riscos

- O uploader extraído toca o fluxo de imagem do Box, que é código em produção. A
  extração é mecânica e coberta pelos testes de Box existentes, mas é a única
  parte deste projeto que mexe em caminho que já roda.
- Texto institucional é conteúdo público. Quem tem `organizer` passa a poder
  publicar texto na primeira tela do app sem revisão. É a mesma exposição que
  `organizer` já tem em eventos e loja.
