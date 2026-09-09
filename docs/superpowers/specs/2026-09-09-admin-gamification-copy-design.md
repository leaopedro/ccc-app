# Admin da copy de gamificação

Data: 2026-09-09
Status: aprovado, pronto para review adversarial

## Problema

O texto das conquistas e os nomes dos níveis estão em constantes de código, em
três lugares:

- `packages/shared/src/badges-copy.ts` — `BADGE_TITLES_PT_BR`, usado pela API
  para montar o corpo da notificação de conquista concedida.
- `apps/mobile/src/copy/badges.ts` — `badgesCopy`, embutido no bundle do app.
  A rota `apps/mobile/app/(app)/garage/index.tsx:31-37` mapeia
  `badgesCopy.badges.catalog` para o prop `copy` de `BadgesSheet`.
- `apps/api/src/services/garage/progress.ts:14-20` — `RANK_TIERS`, com nome,
  corte de XP e o nome do próximo nível.

A API manda só o `code` no wire (`badgeCatalogEntrySchema` em
`packages/shared/src/badges.ts:17-23`), então trocar o título de uma conquista
hoje exige republicar o app.

## Escopo

Dentro:

- Título e descrição das 12 conquistas do catálogo.
- Nome dos 5 níveis.
- Admin, wire, e o consumo no mobile com fallback para o bundle.

Fora, e deliberadamente:

- **Critério das conquistas.** É copy morta: `BadgesSheetCopy`
  (`packages/ui/src/BadgesSheet.tsx:33-38`) só tem `title` e `description`, e a
  rota só mapeia esses dois. Tornar o critério editável não muda um pixel até
  alguém construir onde exibi-lo.
- **Labels da tela de conquistas.** Também não vêm do arquivo de copy: estão
  hardcoded dentro dos primitivos, em `BadgesSheet.tsx:16` e `:27`
  (`CATEGORY_LABEL` e as abas) e `BadgeDetail.tsx:11` e `:213` (`'Bloqueado'`,
  `'Conquistado em'`). Editá-los exigiria antes adicionar props de copy em dois
  componentes de `packages/ui`, mais o threading da rota.
- Criar ou remover conquista. Badge novo nasceria sem regra de premiação.
- Editar os cortes de XP dos níveis. Continuam em código.
- Locale EN. A copy PT-BR é a editável; o scaffold EN do bundle fica como está.

## Decisões

**Texto de conquista vira coluna em `Badge`.** `title` `VarChar(80)` e
`description` `VarChar(240)`, NOT NULL, populados na migration com os valores
de hoje. Mesmos tamanhos de `HomeBenefit` (`schema.prisma:2099-2100`), que é o
precedente mais próximo. É a tabela que já tem uma linha por conquista, então o
texto fica junto da entidade e a FK de `GarageBadge.badgeCode` continua sendo a
única fonte de verdade sobre quais códigos existem.

**Nome de nível vira `rankNames Json` em `GeneralSettings`.** Mapa de cinco
chaves fixas validado por Zod. Nível não é entidade: o corte de XP continua em
código e só o nome é editável, então uma tabela de cinco linhas seria máquina
demais para cinco strings.

**`RANK_TIERS` passa a encadear por chave, não por nome.** Hoje cada linha diz
`next: 'Pilotador'` (`progress.ts:14-20`). Com nome editável, esse encadeamento
quebra na primeira renomeação. A tabela em código ganha uma `key` estável
(`iniciante`, `pilotador`, `veterano`, `lendario`, `hall_of_fame`), o `next`
passa a ser derivado da linha seguinte, e o nome exibido é resolvido pela chave
contra o mapa do banco, com o nome de código como fallback quando a chave falta.

**`title` e `description` são opcionais no wire.** Mesmo sendo NOT NULL no
banco. É o que entrega o fallback do bundle: um app novo contra uma API velha
não recebe os campos e cai na copy embutida em vez de estourar no parse de
`garageBadgesOwnerResponseSchema` (`apps/mobile/src/api/garage.ts:114`). Sem
isso, a ordem de deploy vira requisito de correção.

**Nível não muda o wire.** A API já resolve `rank` e `nextRank` para string
antes de serializar (`progress.ts:89-96`), e `garageProgressSchema`
(`packages/shared/src/garage-progress.ts:14-21`) valida como string opaca. O
mobile não muda nada por causa de nível.

**Precondição por versão própria.** O form envia os 12 títulos, então dois
admins se sobrescrevem do mesmo jeito ruim do projeto da home: se B renomeia
EVT-001 e A salva com o valor velho em tela, o diff de A vê diferença e reverte
B. `GeneralSettings` ganha `gamificationCopyVersion Int @default(0)`; o cliente
devolve a versão que leu e o `PUT` incrementa sob precondição, respondendo 409
quando não bate.

Coluna própria em vez de reusar `GeneralSettings.updatedAt`: reusar acoplaria o
token da aba Gerais ao da aba Conquistas, e dois admins em abas diferentes
tomariam 409 sem colisão real.

**Seed não pode reverter edição.** `seedBadgeCatalog`
(`packages/db/prisma/seed.ts:488-500`) faz upsert com
`update: { category, rarity, icon, premiumExclusive }`. `title` e `description`
entram só no `create`. Se entrarem no `update`, uma execução manual do seed
contra prod apaga tudo que o admin escreveu. O seed não roda em nenhum caminho
de deploy (`railway.json:8` é só `prisma migrate deploy`), mas roda à mão.

**O awarder passa a ler o título do banco.** `awarder.ts:166` monta o corpo da
notificação com `badgeTitlePtBr(code)`, uma constante. Passa a ler
`Badge.title` dentro da transação que já está aberta ali. `badgeTitlePtBr`
continua existindo como último fallback.

**Cache do catálogo deixa de ser seguro por premissa.**
`apps/api/src/routes/badges-catalog.ts:8-13` documenta um TTL de 5 minutos
justificado por "the badge catalog is immutable at runtime (seeded once, never
mutated by an API path)". Esta feature mata essa premissa. O `PUT` chama o
`invalidateBadgesCatalogCache()` que já existe, e o comentário é corrigido.
Com mais de uma réplica, a réplica que não recebeu o `PUT` serve texto velho
por até 5 minutos. `badges-read.ts` e o serializer de `GET /me/garage` leem
Prisma direto, sem cache.

**Admin edita com o killswitch desligado.** As rotas admin não consultam
`gamificationEnabled`; só as superfícies públicas consultam.

## Superfície

### Migration

```
ALTER TABLE "Badge" ADD COLUMN "title" VARCHAR(80), ADD COLUMN "description" VARCHAR(240);
-- backfill com os valores de apps/mobile/src/copy/badges.ts (12 linhas)
-- depois: SET NOT NULL nas duas
ALTER TABLE "GeneralSettings"
  ADD COLUMN "rankNames" JSONB,
  ADD COLUMN "gamificationCopyVersion" INTEGER NOT NULL DEFAULT 0;
```

`rankNames` fica nulável no banco; nulo significa "usa os nomes de código".
Evita ter que inventar um default JSON no schema e mantém uma fonte de verdade
só para o valor inicial.

### `packages/shared/src/badges.ts`

`badgeCatalogEntrySchema` ganha:

```
title?:       string 1..80
description?: string 1..240
```

Opcionais. Isso propaga para `badgeCatalogResponseSchema` e
`garageBadgesOwnerResponseSchema` sem mais nenhuma mudança.

### `packages/shared/src/admin-gamification.ts` (novo)

```
RANK_KEYS = ['iniciante','pilotador','veterano','lendario','hall_of_fame']

rankNamesSchema           // Record<RankKey, string.trim() 1..40>, chaves fixas
adminGamificationCopySchema
  version: int
  badges: [{ code, title, description }]
  rankNames: Record<RankKey, string>
gamificationCopyUpdateSchema
  expectedVersion: int
  badges?: [{ code, title: string.trim() 1..80, description: string.trim() 1..240 }]
  rankNames?: Record<RankKey, string.trim() 1..40>
```

### `apps/api/src/services/garage/progress.ts`

`RANK_TIERS` ganha `key`, perde `next` como literal. `deriveProgress(xp)` passa
a receber o mapa de nomes: `deriveProgress(xp, names)`, onde `names` é
`Record<RankKey, string>` resolvido pelo chamador. O nome de código vira o
fallback por chave ausente.

Chamadores a atualizar: `getGarageProgress` e quem mais chamar `deriveProgress`.

### `apps/api/src/routes/admin/gamification-copy.ts` (novo)

Registrado no bloco `requireRole('organizer','admin')` de `admin/index.ts`.

- `GET /admin/gamification/copy` — 12 linhas de `Badge` mais `rankNames` e a
  versão.
- `PUT /admin/gamification/copy` — parse; código desconhecido responde 400;
  precondição de versão; tudo numa transação; diff por campo; incrementa a
  versão; `invalidateBadgesCatalogCache()`; auditoria
  `gamification_copy.update` com os campos tocados.

`packages/shared/src/admin.ts` e `apps/api/src/services/admin-audit.ts` ganham
`'gamification_copy.update'` e `'gamification_copy'`.

### Admin

Aba nova em `/configuracoes/conquistas`, ao lado de Gerais e Home. A
infraestrutura de abas, o `layout.tsx` com gate de staff e a entrada de menu
vêm do projeto da home; se este projeto for implementado antes, ele cria essa
infraestrutura.

Arquivos: `configuracoes/conquistas/page.tsx`,
`configuracoes/gamification-copy-form.tsx`,
`apps/admin/src/lib/gamification-copy-actions.ts`, dois wrappers em
`admin-api.ts`, e a entrada nova em `settings-tabs.tsx`.

O form: 12 blocos de título e descrição com contador, 5 campos de nome de
nível, Salvar, e tratamento explícito do 409.

### Mobile

Só `apps/mobile/app/(app)/garage/index.tsx`. `BADGE_COPY` deixa de ser
construído no escopo do módulo a partir de `badgesCopy` e passa a ser derivado
do `catalog` da resposta, por código:

```
title       = entry.title       ?? badgesCopy.badges.catalog[code]?.title
description = entry.description ?? badgesCopy.badges.catalog[code]?.description
```

`apps/mobile/src/copy/badges.ts` fica como fonte do fallback, sem alteração.

## Testes

API, contra Postgres real:

- `PUT` altera título, descrição e nome de nível, e o `GET` seguinte reflete.
- Código fora do catálogo responde 400 e não cria linha.
- Texto vazio, só espaço e acima do limite respondem 400.
- `expectedVersion` velho responde 409 e não escreve nada, provando a
  transação.
- Auditoria grava os campos tocados; `PUT` sem mudança não audita e não
  incrementa a versão.
- `GET /badges/catalog` logo após o `PUT` já mostra o título novo. É o que
  prova a invalidação do cache de 5 minutos.
- `GET /me/garage/badges` carrega `title` e `description` no catálogo.
- Conceder conquista depois de editar o título produz notificação cujo `body` é
  o título novo. Cobre a troca no `awarder`.
- `deriveProgress` devolve o nome editado, e cai no nome de código quando a
  chave falta no mapa.
- Rodar `seedBadgeCatalog` depois de uma edição não reverte o texto.

Mobile:

- Teste da rota de garagem: título da API vence o do bundle; bundle entra
  quando a API omite os campos.

## Riscos

- `deriveProgress` muda de assinatura. É função pura com testes próprios, mas
  todo chamador precisa passar o mapa de nomes; um chamador esquecido só
  aparece no typecheck, não em runtime.
- A migration faz backfill de 12 linhas a partir de copy que hoje vive no
  bundle do mobile. Os valores precisam ser copiados verbatim de
  `apps/mobile/src/copy/badges.ts`, senão a primeira release muda texto sem
  ninguém ter pedido.
- Com mais de uma réplica da API, o texto novo leva até 5 minutos para aparecer
  nas réplicas que não receberam o `PUT`.
