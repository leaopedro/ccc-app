# Box item tier-gating (optional, per-item) — design

Data: 2026-08-16. Branch: `feat/box-item-tier-gating` (parte de `main`).

## Objetivo

Permitir que um item do catálogo da Caixa seja opcionalmente restrito a um
nível mínimo de assinatura. Hoje `BoxCatalogItem` não tem campo de tier:
todos os tiers Premium veem o mesmo catálogo, e o que separa bronze de gold
é apenas o orçamento em R$ (`PremiumPlan.monthlyBoxBudgetCents`). Este design
adiciona gating por tier, mantendo o default atual (sem restrição) intacto.

Tiers existentes (`GaragePremiumTier`, ordenados): `bronze < silver < gold`.

## Decisões (fechadas com o usuário)

1. **Modelo de gating: nível mínimo.** Cada item tem um `minTier` opcional.
   `null` = todos (default, comportamento atual). `silver` = visível para
   silver + gold, oculto/bloqueado para bronze. Hierárquico.
2. **Exibição para quem está abaixo: configurável por item.** Cada item
   decide se, para tiers abaixo do `minTier`, ele fica **bloqueado** (aparece
   travado com selo, gera upsell) ou **oculto** (some do catálogo). Default
   `locked`.
3. **Enforcement no servidor (cliente nunca é confiável):** um item
   bloqueado/oculto não pode ser adicionado nem confirmado, independente do
   que o cliente enviar.

## Escopo fechado

- Adiciona `minTier` + `restrictedDisplay` a `BoxCatalogItem` (migration
  aditiva).
- Filtra/marca no read (`buildBoxCatalog`) pelo tier do membro.
- Guarda no write (selection-save e confirm).
- Admin: form ganha "Nível mínimo" + "Para níveis abaixo".
- Mobile: renderiza item `locked` como card travado com selo.

**Fora de escopo:** o campo `category` fica como está (era o workaround
anterior; gating real o substitui, mas não migramos dados de categoria).
Sem mudança em budget/charge — gating é ortogonal a preço. Sem allowlist
arbitrária de tiers (só nível mínimo). Sem gating de módulos de parceiro.

## 1. Data model (`packages/db/prisma/schema.prisma`)

Novo enum:

```prisma
enum BoxItemRestrictedDisplay {
  locked
  hidden
}
```

Em `BoxCatalogItem`:

```prisma
minTier           GaragePremiumTier?
restrictedDisplay BoxItemRestrictedDisplay @default(locked)
```

- `minTier` null = sem restrição (todos os tiers). É o default para linhas
  existentes → comportamento atual preservado.
- `restrictedDisplay` só tem efeito quando `minTier` não é null.
- Migration aditiva. Sem backfill de dados (default cobre linhas antigas).
  Ordenar o valor default do enum (`locked` primeiro).

Índice: nenhum novo necessário (o filtro roda em memória sobre o resultado
já lido por `active`; catálogo é pequeno).

## 2. Shared (`packages/shared`)

### 2a. Helper de ranking (`packages/shared/src/box.ts` ou novo `tier.ts`)

Reusa `garagePremiumTierSchema` de `garage.ts`.

```ts
import type { GaragePremiumTier } from './garage.js';

export const TIER_RANK: Record<GaragePremiumTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
};

/** true se userTier satisfaz minTier. minTier null = sempre true. */
export const meetsMinTier = (
  userTier: GaragePremiumTier,
  minTier: GaragePremiumTier | null,
): boolean => minTier === null || TIER_RANK[userTier] >= TIER_RANK[minTier];
```

Colocado em `box.ts` (perto dos schemas de caixa) para não criar arquivo
novo por uma função. Exportado pelo barrel `@ccc/shared/box`.

### 2b. Read type — `boxCatalogItemSchema` (`box.ts:84`)

Adiciona dois campos:

```ts
export const boxCatalogItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  maxPerCycle: z.number().int().nullable(),
  soldOut: z.boolean(),
  locked: z.boolean(),
  minTier: garagePremiumTierSchema.nullable(),
});
```

- `locked: true` → o membro está abaixo do `minTier` e o item é
  `restrictedDisplay=locked`. Aparece no catálogo mas não é selecionável.
- `minTier` acompanha para o app montar o selo ("Silver+"/"Gold+").
- Itens `hidden` para o membro NÃO entram na resposta (omitidos no serviço).
- Import de `garagePremiumTierSchema` de `./garage.js`.

### 2c. Admin schemas (`packages/shared/src/admin-box.ts`)

`adminBoxCatalogItemSchema` (read, ~linha 19) ganha:

```ts
minTier: garagePremiumTierSchema.nullable(),
restrictedDisplay: z.enum(['locked', 'hidden']),
```

`adminBoxCatalogItemCreateSchema` (~linha 35) ganha:

```ts
minTier: garagePremiumTierSchema.nullable().optional(),
restrictedDisplay: z.enum(['locked', 'hidden']).optional(),
```

`adminBoxCatalogItemUpdateSchema` (~linha 51) ganha os mesmos dois como
`.optional()`. Import de `garagePremiumTierSchema` de `./garage.js`.

## 3. API read — `buildBoxCatalog` (`apps/api/src/services/box/catalog.ts`)

Assinatura ganha o tier do membro:

```ts
export const buildBoxCatalog = async (
  uploads: Uploads,
  cycleKey: string,
  userTier: GaragePremiumTier,
): Promise<BoxCatalog> => { ... }
```

No `map` dos itens, calcular visibilidade:

```ts
const meets = meetsMinTier(userTier, i.minTier);
```

- `meets === false` e `i.restrictedDisplay === 'hidden'` → **omitir** o item
  (filtrar antes do map, ex: `.flatMap` ou filtrar a lista).
- `meets === false` e `i.restrictedDisplay === 'locked'` → incluir com
  `locked: true`, `minTier: i.minTier`.
- `meets === true` → `locked: false`, `minTier: i.minTier` (pode ser null).

`categories` deve derivar apenas dos itens **visíveis** (após remover os
hidden), para que uma categoria cujos itens são todos ocultos para aquele
membro não apareça como filtro vazio:

```ts
categories: [...new Set(visibleItems.map((i) => i.category))],
```

### Route (`apps/api/src/routes/box.ts`)

`loadEligibleMembership` hoje seleciona `{ id: true }`. Estender para incluir
`tier: true`. No handler de `/me/box/catalog`, passar `membership.tier`:

```ts
return reply.send(await buildBoxCatalog(app.uploads, box.cycleKey, membership.tier));
```

## 4. API write guards (defense in depth)

O cliente nunca é confiável: um item bloqueado/oculto não pode ser
persistido nem cobrado.

### 4a. Selection-save (`apps/api/src/routes/box.ts`, loop `input.items`)

O handler precisa do tier do membro. `loadEligibleMembership` já será
estendido para trazer `tier`; usar `membership.tier` aqui. No loop, após
carregar `item` e checar `active`, adicionar:

```ts
if (!meetsMinTier(membership.tier, item.minTier)) continue; // gated: ignora
```

Fica na mesma posição do `continue` que já ignora itens inativos/desconhecidos
(silencioso, consistente). Um item abaixo do tier simplesmente não é
adicionado à caixa. Vale para os dois caminhos (`quantity===0` remove é
inofensivo; o guard fica no ramo de upsert).

### 4b. Confirm (`apps/api/src/services/box/confirm.ts`, loop de reserva ~65)

`confirmBox` recebe `membershipId`; precisa do `tier`. Carregar o tier junto
(ex: `tx.premiumMembership.findUnique({ where: { id: membershipId }, select:
{ tier: true } })`) uma vez antes do loop. No loop, após `findUniqueOrThrow`
do item:

```ts
if (!meetsMinTier(tier, item.minTier)) {
  await tx.monthlyBoxItem.update({
    where: { id: line.id },
    data: { included: false, droppedAt: new Date(), dropReason: 'tier_restricted' },
  });
  continue;
}
```

`dropReason` é `String? @db.VarChar(40)` (texto livre) — `'tier_restricted'`
cabe, sem mudança de enum. Belt-and-suspenders: cobre o caso de uma linha
persistida antes de uma troca de tier (downgrade) ou antes de um item ganhar
`minTier`.

## 5. Admin UI (`apps/admin`)

Localizar o form de item do catálogo (create/update) sob
`apps/admin/app/(authed)/box/` e a action em `src/lib/box-admin-actions.ts` /
`admin-api.ts`.

- Campo "Nível mínimo": select com opções `Todos` (null) / `Bronze` /
  `Silver` / `Gold`, mapeando para `minTier`.
- Quando `minTier != null`, revelar "Para níveis abaixo": toggle
  `Bloquear` (`locked`) / `Ocultar` (`hidden`) → `restrictedDisplay`.
  Escondido/desabilitado quando `minTier` é `Todos`.
- Lista de itens: selo/coluna mostrando o `minTier` quando setado (ex:
  "Silver+"). Se a lista atual não tiver espaço, um pequeno badge basta.

Copy PT-BR. Segue os componentes de form já existentes na tela do catálogo.

## 6. Mobile UI (`apps/mobile`)

`src/screens/caixa/builder-selection.ts` (filtro por categoria) e a tela que
renderiza os cards do catálogo.

- Itens agora podem ter `locked: true` + `minTier`. Renderizar card travado:
  visualmente desabilitado (opacidade/cadeado), selo "Silver+"/"Gold+"
  derivado de `minTier`, **não** tappável (não abre seleção, não incrementa
  quantidade).
- O filtro por categoria (`builder-selection.ts`) não muda: itens locked
  continuam aparecendo nas suas categorias; itens hidden nem chegam.
- Selo: mapear `minTier` → label ("silver" → "Silver+", "gold" → "Gold+").

## 7. Testes

### Shared

- `meetsMinTier`: bronze vs null/bronze/silver/gold; silver vs silver/gold;
  gold vs tudo. Tabela de ranking.

### API read (`buildBoxCatalog`, Testcontainers/Postgres real)

- Membro bronze: item sem minTier → presente, `locked:false`; item
  `minTier=silver, locked` → presente, `locked:true`, `minTier='silver'`;
  item `minTier=silver, hidden` → ausente; item `minTier=gold` → conforme
  display.
- `categories` não inclui categoria cujos itens são todos hidden para o
  membro.
- Membro gold: todos os itens `meets`, nenhum `locked`.

### API write

- Selection-save: membro bronze tentando adicionar item `minTier=silver` →
  linha não persistida (não aparece na caixa).
- Confirm: linha de item acima do tier do membro é dropada com
  `dropReason='tier_restricted'` e `included=false`; não reserva estoque nem
  entra no total.

### Suites existentes

- Catálogo, confirm, box: seguem verdes (default `minTier=null` preserva o
  comportamento atual).

## Contrato de interface (fonte única pro plano)

- **Migration:** enum `BoxItemRestrictedDisplay { locked hidden }`;
  `BoxCatalogItem.minTier GaragePremiumTier?`,
  `BoxCatalogItem.restrictedDisplay BoxItemRestrictedDisplay @default(locked)`.
- **Shared:** `TIER_RANK`, `meetsMinTier(userTier, minTier)` em `box.ts`;
  `boxCatalogItemSchema` +`locked: boolean` +`minTier: nullable`;
  `admin-box.ts` schemas + `minTier` + `restrictedDisplay`.
- **API:** `buildBoxCatalog(uploads, cycleKey, userTier)`;
  `loadEligibleMembership` seleciona `tier`; route passa `membership.tier`;
  guard em selection-save; guard + drop `'tier_restricted'` em confirm
  (carregando `tier` do membership).
- **Admin:** form "Nível mínimo" + "Para níveis abaixo"; selo na lista.
- **Mobile:** card locked com selo, não selecionável; filtro de categoria
  intacto.
