# Admin da copy de gamificação

Data: 2026-09-09
Status: revisado após review adversarial, pronto para plano

## Problema

O texto das conquistas e os nomes dos níveis estão em constantes de código:

- `packages/shared/src/badges-copy.ts` — `BADGE_TITLES_PT_BR`, usado pela API
  no corpo da notificação de conquista concedida.
- `apps/mobile/src/copy/badges.ts` — `badgesCopy`, embutido no bundle. A rota
  `apps/mobile/app/(app)/garage/index.tsx:31-37` mapeia
  `badgesCopy.badges.catalog` para o prop `copy` de `BadgesSheet`.
- `apps/api/src/services/garage/progress.ts:14-20` — `RANK_TIERS`.

A API manda só o `code` no wire, então trocar um título hoje exige republicar
o app.

## Escopo

Dentro: título e descrição das 12 conquistas, nome dos 5 níveis, admin, wire, e
o consumo no mobile com fallback do bundle.

Fora, e deliberadamente:

- **Critério das conquistas.** Copy morta: `BadgesSheetCopy`
  (`packages/ui/src/BadgesSheet.tsx:33-38`) só tem `title` e `description`.
- **Labels da tela.** Hardcoded nos primitivos: `BadgesSheet.tsx:16` e `:27`,
  `BadgeDetail.tsx:11` e `:213`. Exigiria props de copy em `packages/ui`.
- Criar ou remover conquista; editar cortes de XP; locale EN.

## Ordem em relação ao projeto da home

Este projeto e `2026-09-09-admin-home-content-design.md` tocam os mesmos cinco
arquivos: as duas uniões de auditoria em `packages/shared/src/admin.ts:23,130`,
o union de `apps/api/src/services/admin-audit.ts:8-37`, o bloco de register em
`apps/api/src/routes/admin/index.ts:57-84`, `apps/admin/src/lib/admin-api.ts` e
o `TABS` de `settings-tabs.tsx`. São appends mecânicos, mas o segundo a chegar
não faz merge limpo.

**Este projeto assume que o da home já entrou** e apenas _edita_ o `TABS`
existente para acrescentar `{ href: '/configuracoes/conquistas', label:
'Conquistas' }`. Se a ordem inverter, este projeto precisa criar antes toda a
infraestrutura que o spec da home descreve: `configuracoes/layout.tsx` com o
gate de staff movido para fora da page, `settings-tabs.tsx`, e a entrada
`/configuracoes` em `ORGANIZER_LINKS` (`authed-nav.tsx:11-22`), que hoje não
existe em lugar nenhum do admin.

O gate de staff é a parte não negociável dessa ordem. Hoje ele mora em
`configuracoes/page.tsx:9-22`. Criar `/configuracoes/conquistas` sem o layout
que o carrega entrega o editor de copy renderizado para uma sessão staff, que
só falha no save: `apps/admin/middleware.ts:5-18` não cobre `/configuracoes`.

A regra de aba ativa não pode ser copiada de `store-section-tabs.tsx:15-16`.
Lá nenhum href é prefixo de outro; aqui `/configuracoes` é prefixo de
`/configuracoes/home` e `/configuracoes/conquistas`, então
`pathname.startsWith(href)` marca Gerais como ativa nas três rotas. Gerais casa
por igualdade exata, as outras por prefixo.

## Decisões

**Texto de conquista vira coluna em `Badge`.** `title` `VarChar(80)` e
`description` `VarChar(240)`, NOT NULL. `HomeBenefit` (`schema.prisma:2099-2100`)
é o precedente de tamanho, não de nulabilidade: lá `description` é opcional,
aqui as duas são obrigatórias de propósito, para nenhuma superfície ter que
lidar com conquista sem texto.

**Nome de nível vira `rankNames Json` em `GeneralSettings`,** nulável. Nulo
significa "usa os nomes de código". Nível não é entidade e o corte de XP
continua em código, então uma tabela de cinco linhas seria máquina demais.

**`RANK_TIERS` encadeia por índice, não por nome nem por linha derivada.** Cada
linha ganha `key` (`iniciante`, `pilotador`, `veterano`, `lendario`,
`hall_of_fame`), perde `next` e perde `nextAt` na linha de topo.

O guard de topo **não pode** virar `next === undefined`. Hoje é
`const atTop = tier.next === null` (`progress.ts:75`), e derivar `next` da linha
seguinte produz `undefined`, que não é `null`: o topo cairia no
`tier.nextAt as number` do `:88` com `nextAt` nulo, gerando
`xpToNextRank = -5000` e `tierSpan = -5000`. `garageProgressSchema`
(`packages/shared/src/garage-progress.ts:19-20`) exige `nonnegative()` e
`min(1)`, então isso é 500 no `GET /me/garage` (`garage.ts:116`) e no
`GET /g/:slug` (`garage.ts:522`) para todo usuário em Hall of Fame.

O guard passa a ser posicional: o loop de `:66-72` preserva o índice, e
`atTop` é `i === RANK_TIERS.length - 1`. `nextAt` sai da linha de topo para que
nenhuma leitura futura consiga tipar `null` como `number`.

**`deriveProgress(xp, names?)`**, com `names: Partial<Record<RankKey, string>>`
e default `{}`. Parcial, não total: a resolução é `names[key] ?? codeName(key)`,
e um `Record` total não teria chave ausente para cair no fallback. Opcional
para os 11 call sites de `apps/api/test/garage/progress.test.ts:10-99`
continuarem válidos.

**Os dois nomes resolvem, não só um.** `deriveProgress` devolve `rank` e
`nextRank`, e `XPScoreboard.tsx:71` renderiza o caption
`${xpToNextRank} → ${nextRank}`. Resolver só o atual faria o usuário ver o nome
novo na pílula e o antigo no caption.

**`RankName` deixa de ser união literal.** Hoje `progress.ts:22` deriva
`RankName` de `RANK_TIERS[number]['name']` e tipa `GarageProgress.rank` e
`nextRank` com ela. Com nome editável isso vira mentira: alarga para `string`.

**A leitura do JSON é tolerante, a escrita é estrita.** `rankNamesSchema` é
`z.object` com as cinco chaves obrigatórias, não `z.record`: em Zod 3 um
`z.record(z.enum(...))` tipa a saída como `Record` completo mas não valida
exaustividade, então um `PUT` com uma chave só passaria e apagaria quatro
nomes. Na leitura, `safeParse` com fallback por chave para o nome de código.
Nunca `as Record<...>` sobre a coluna crua: `rankNames` é `Json` sem forma no
banco, é nulo em produção até o primeiro save, e as duas rotas que o consomem
são caminhos quentes que fazem `parse` da própria resposta.

**Precondição é a própria escrita, não uma comparação em JS.** Ler a versão,
comparar e depois escrever perde update mesmo dentro de `$transaction`: o
default é Read Committed e um `SELECT` não trava linha, então dois admins que
leem versão 5 passam os dois no teste e gravam os dois. A primeira escrita da
transação é:

```ts
const { count } = await tx.generalSettings.updateMany({
  where: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationCopyVersion: expectedVersion },
  data: { gamificationCopyVersion: { increment: 1 }, ...(rankNames ? { rankNames } : {}) },
});
if (count !== 1) → 409
```

Só depois vêm os `UPDATE` de `Badge`, na mesma transação. A linha de
`GeneralSettings` funciona como lock e serializa os concorrentes. `GET` e `PUT`
chamam `ensureGeneralSettings()` antes: a linha pode não existir
(`killswitch.ts:35` faz `?? true` justamente por isso, e
`apps/api/test/helpers.ts:123` a apaga a cada teste), e sem isso o primeiro save
num banco limpo dá 409 para sempre.

Coluna própria em vez de reusar `updatedAt`: reusar acopla o token da aba
Gerais ao da aba Conquistas. Nota: `GeneralSettings` é `@updatedAt`, então um
save de Conquistas bumpa o `updatedAt` que `serializeAdminGeneralSettings`
expõe. Inócuo hoje, porque `generalSettingsUpdateSchema` não tem precondição.

**Rota restrita a `requireRole('admin')`, não organizer.** Diferente de
general-settings. `awarder.ts:166` passa a mandar texto editável para o inbox
de um usuário escolhido, e o grant manual
(`admin/user-garage.ts:397`, `notifyOnGrant: true`) é organizer com balde de
30/min. O canal deliberado de organizer para usuário é o broadcast, limitado a
5 por 15 minutos (`admin/index.ts:88-100`). Deixar copy em organizer abre um
caminho 360x mais frouxo e direcionado. Editar copy também não é tarefa
operacional de organizer. Reversível numa palavra se você discordar.

**Balde próprio e payload limitado.** Bloco de register separado com 30/min por
ator e `hook: 'preHandler'`, como todas as superfícies de escrita pesada do
admin. `badges` no máximo 12 entradas, código repetido rejeitado com 400 antes
da transação. Sem isso o limite de 1 MB de body do Fastify permite ~10 mil
`UPDATE` numa transação que já segura o lock do singleton.

**Invalidação do cache depois do commit.** `invalidateBadgesCatalogCache()`
roda _após_ o `$transaction` resolver. Dentro dela, uma leitura concorrente
repopula `cached` (`badges-catalog.ts:37-40`) com linhas pré-commit e fixa
texto velho pelo TTL inteiro, pior que não invalidar.

Há uma terceira camada fora do alcance disso: `apps/admin/src/lib/public-garage.ts:26`
busca `/badges/catalog` com `next: { revalidate: 300 }`, e o data cache do Next
não é invalidado por nada aqui. A garagem pública renderizada pelo admin fica
com texto velho por até 5 minutos além do TTL da API.

Não há risco de múltiplas réplicas: `railway.json:12` é `numReplicas: 1`.

**`badgeTitlePtBr` e `BADGE_TITLES_PT_BR` são deletados.** Com `Badge.title`
NOT NULL e o awarder lendo a linha, viram inalcançáveis. `awarder.ts:101` já
faz `tx.badge.findUnique({ where: { code } })` e `:102` lança se não achar, então
`badge.title` está em escopo no `:166`: nenhuma query nova, e nenhum fallback
real a manter. Deletar também remove uma das cópias da mesma copy.

**`Notification.body` é snapshot, e isso fica escrito.** O corpo é gravado no
momento da concessão. Renomear depois não reescreve inbox nem o export LGPD
(`services/data-export.ts:216`), e o dedupe por
`badge:${code}:${userId}` contra `@@unique([userId, kind, dedupeKey])` impede
que um re-grant reemita com o texto novo. Decisão consciente: histórico é
histórico. A alternativa seria resolver `body` na leitura a partir do `code`
que já viaja em `data`, e não vale a mudança de contrato do inbox.

**Caps vêm do que renderiza, não do precedente de schema.** `title` 40 e nome
de nível 20 no Zod, com as colunas em 80 e o JSON livre.
`BadgeDetail.tsx:146-159` centraliza o título em `fontSize: 22` sem `maxWidth`
nem `numberOfLines`, enquanto a descrição logo abaixo tem `maxWidth: 280`; e a
pílula de nível (`XPScoreboard.tsx:205-216`) é `fontSize: 10` uppercase com
`letterSpacing: 1.6` numa `row` sem `flexShrink`. Os títulos atuais têm no
máximo 18 caracteres e o maior nome de nível tem 12, então os caps são folgados.
`description` fica em 240, que é o que a coluna aceita e o que já cabe no
`maxWidth: 280`.

**`title` e `description` são opcionais no wire.** É o que entrega o fallback
do bundle: um app novo contra uma API velha não recebe os campos e cai na copy
embutida em vez de estourar no parse de `garageBadgesOwnerResponseSchema`
(`apps/mobile/src/api/garage.ts:114`). O caminho inverso já é seguro:
`badgeCatalogEntrySchema` não é `.strict()`, então app velho descarta as chaves
novas.

## Superfície

### Migration

Fluxo da casa: `pnpm db:migrate dev --name <nome> --create-only`
(`docs/engineering-workflow.md:196`) e depois editar o SQL à mão. Precedente de
três passos com `SET NOT NULL`:
`migrations/20260521000000_car_fields_extension/migration.sql:74`.

```sql
ALTER TABLE "Badge" ADD COLUMN "title" VARCHAR(80), ADD COLUMN "description" VARCHAR(240);
-- backfill dos 12 códigos, verbatim de apps/mobile/src/copy/badges.ts
-- sweep terminal: qualquer linha fora do catálogo cai no próprio código
UPDATE "Badge" SET "title" = COALESCE("title", "code"),
                   "description" = COALESCE("description", "code")
 WHERE "title" IS NULL OR "description" IS NULL;
ALTER TABLE "Badge" ALTER COLUMN "title" SET NOT NULL,
                    ALTER COLUMN "description" SET NOT NULL;
ALTER TABLE "GeneralSettings"
  ADD COLUMN "rankNames" JSONB,
  ADD COLUMN "gamificationCopyVersion" INTEGER NOT NULL DEFAULT 0;
```

O sweep não é zelo: `Badge.code` só tem `@unique`, o catálogo já foi reescrito
em produção uma vez (`migrations/20260708000000_rebrand_badge_codes_ccc/`), e
uma linha órfã faz o `SET NOT NULL` abortar o `preDeployCommand`
(`railway.json:8`). Prisma então marca a migration como `failed` e toda release
seguinte falha até alguém rodar `migrate resolve --rolled-back` contra prod.
`code` como fallback, e não string vazia, porque os schemas são `min(1)`.

Rollback: `docs/engineering-workflow.md:310-313` exige plano de volta por
migration. Reverter o código com as colunas no lugar é seguro, porque nenhum
caminho antigo escreve `Badge`. Documentar isso e o caminho de
`migrate resolve` num `docs/migration-rollback-*.md`, como os cinco que já
existem.

### As três cópias da copy

Depois de deletar `BADGE_TITLES_PT_BR`, os mesmos 12 títulos existem em: o SQL
do backfill, o `BADGES` de `packages/db/prisma/seed.ts:431` (que ganha os dois
campos, senão `create: b` no `:492` para de compilar) e
`apps/mobile/src/copy/badges.ts`, que segue como fonte do fallback. Divergir
uma delas muda texto sem ninguém pedir, e nada em CI pega isso: o
`global-setup.ts:22` roda `migrate deploy` contra container vazio, então o
backfill nunca vê linha preexistente.

`seedBadgeCatalog` (`seed.ts:488-500`) mantém `update: { category, rarity, icon,
premiumExclusive }`. `title` e `description` só no `create`, senão uma execução
manual do seed apaga o que o admin escreveu.

### Arquivos da API

- `packages/shared/src/badges.ts` — `title`/`description` opcionais em
  `badgeCatalogEntrySchema`.
- `apps/api/src/routes/badges-catalog.ts:44-50` e
  `apps/api/src/services/garage/badges-read.ts:39-45` — os dois montam a entrada
  campo a campo e precisam emitir os campos novos. Zod remove chave
  desconhecida, não adiciona: sem editar os dois, o schema opcional é inerte.
  `badges-catalog.ts:8-13` também perde o comentário que afirma que o catálogo é
  imutável em runtime.
- `apps/api/src/services/garage/progress.ts` — `key`, guard posicional,
  `deriveProgress(xp, names?)`, `RankName` como `string`.
- `apps/api/src/routes/garage.ts:116` e `:522` — as duas já leem
  `GeneralSettings` via `readGamificationEnabled` no mesmo `Promise.all`. Passam
  a ler a linha uma vez e a repassar `names`, em vez de `getGarageProgress`
  fazer uma segunda leitura do mesmo singleton por request.
- `apps/api/src/services/garage/awarder.ts:166` — `badge.title`.
- `packages/shared/src/badges-copy.ts` — remover `BADGE_TITLES_PT_BR` e
  `badgeTitlePtBr`, manter o resto.
- `apps/api/src/routes/admin/gamification-copy.ts` (novo) e o registro em
  `admin/index.ts`, em bloco próprio com `requireRole('admin')` e balde.
- `packages/shared/src/admin-gamification.ts` (novo) e as duas uniões de
  auditoria (`gamification_copy.update`, `gamification_copy`).

### Admin

`/configuracoes/conquistas`: `page.tsx`, `gamification-copy-form.tsx`,
`apps/admin/src/lib/gamification-copy-actions.ts`, dois wrappers em
`admin-api.ts`, e a entrada nova no `TABS` de `settings-tabs.tsx`. O form tem 12
blocos de título e descrição com contador, 5 nomes de nível, Salvar e
tratamento explícito do 409.

### Mobile

Só `apps/mobile/app/(app)/garage/index.tsx`. `BADGE_COPY` sai do escopo do
módulo e vira `useMemo` sobre `badgesAggregate`:

```
title       = entry.title       ?? badgesCopy.badges.catalog[code]?.title
description = entry.description ?? badgesCopy.badges.catalog[code]?.description
```

`BadgeDetail` passa a poder ver o título por dois caminhos: o prop `title` que
`BadgesSheet.tsx:101` resolve do `copy`, e o `entry.title` que agora vem no
catálogo. O prop continua vencendo; `packages/ui` fica fora de escopo e não lê
`entry.title`.

## Testes

Fixtures existentes, antes de qualquer teste novo. Sete arquivos criam `Badge`
sem texto e param de compilar: `test/garage/badges.test.ts:15`,
`badges-write-hooks.test.ts:12`, `awarder.test.ts:12`,
`xp-badge-award.test.ts:9`, `badges-dsr.test.ts:10` e `:97`,
`test/admin/badge-manual-grant.test.ts:9`, `badge-notification.test.ts:21`.

`badge-notification.test.ts:79` e `:111` afirmam
`row.body === badgeTitlePtBr(code)`. Com a constante deletada, viram asserção
contra um título literal, e a fixture precisa carregar um título diferente do
esperado em pelo menos um caso, senão o teste passa sem provar que o awarder lê
do banco.

Note que várias fixtures usam códigos fora do catálogo (`'JDM-099'`,
`'EVT-777'`, `'CAR-007'` em `xp-badge-award.test.ts`), então a rejeição de
código desconhecido no `PUT` não pode compartilhar lista com o que essas tocam.

Novos, contra Postgres real:

- `PUT` altera título, descrição e nome de nível; o `GET` seguinte reflete.
- Código fora do catálogo, código repetido e array acima de 12 respondem 400.
- Texto vazio, só espaço e acima do limite respondem 400.
- `expectedVersion` velho responde 409, e nenhum `Badge` foi escrito, provando
  a transação.
- Duas escritas concorrentes com a mesma versão: uma vence, a outra toma 409.
  Serial não prova nada aqui.
- `PUT` sem mudança não audita e não incrementa a versão.
- `GET` e `PUT` funcionam com a linha de `GeneralSettings` ausente.
- Staff e organizer tomam 403; admin passa.
- `GET /badges/catalog` logo após o `PUT` mostra o título novo.
- `GET /me/garage/badges` carrega `title` e `description`.
- Conceder conquista depois de editar produz notificação com o título novo.
- `deriveProgress` no topo devolve `nextRank: null`, `xpToNextRank: 0`,
  `tierSpan: 1` com os nomes remapeados. É o teste do guard posicional.
- `deriveProgress` resolve `rank` e `nextRank` pelo mapa, e cai no nome de
  código quando a chave falta.
- `rankNames` com forma inválida no banco não derruba `GET /me/garage`.
- Rodar `seedBadgeCatalog` depois de uma edição não reverte o texto.

Mobile: título da API vence o do bundle; bundle entra quando a API omite.
`GarageIndexRoute.test.tsx:356-365` já fornece catálogo sem os campos, então
esse arquivo já cobre o segundo caso sem alteração.

## Riscos

- Três cópias dos mesmos 12 títulos, e o CI não compara nenhuma com outra.
- A migration é a única parte sem cobertura possível: o backfill nunca roda
  contra dados reais em teste.
- `RankName` alargar para `string` remove uma checagem de tipo que hoje existe.
  Nada persiste nome de nível, então o risco é de digitação, não de dados.
