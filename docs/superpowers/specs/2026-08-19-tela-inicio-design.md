# Tela de Início — vitrine para usuário não logado

Data: 2026-08-19
Branch: `feat/tela-inicial`
Handoff de design: `.handoffs/design_handoff_inicio/`

## Objetivo

Reestruturar a primeira tela do app (`/welcome`) como vitrine do clube para o
usuário não autenticado, com conteúdo administrável pelo banco de dados sem
republicar o app nas lojas. O estado logado fica preparado estruturalmente, sem
mudança visual nesta entrega.

## Conflitos resolvidos antes de codificar

O handoff desenha a home do **membro logado** (saudação, `MEMBRO #0001`, próximo
evento, status do clube, acesso rápido). A User Story pede a vitrine do **não
logado**, em 6 seções. Decisões tomadas com o solicitante:

1. **Uma tela, dois estados.** A rota `/welcome` continua sendo a única tela
   inicial. Anon renderiza as 6 seções da Story. Logado mantém exatamente o que
   vê hoje. Os componentes visuais do handoff nascem compartilhados, então a home
   do membro é uma PR seguinte sem reescrita.
2. **Seção 6 sem modelo de domínio novo.** Não existem entidades `DayUse` nem
   `Experience` no schema. Day Use e experiências entram como itens curados na
   tabela de destaques institucionais. Eventos e parceiros seguem vindo dos
   modelos existentes quando forem ligados.
3. **Conteúdo institucional como singleton + tabelas filhas**, no padrão já usado
   por `GeneralSettings`, `BoxSettings` e `StoreSettings`.
4. **Escopo desta entrega:** banco, endpoint de leitura, seed e front mobile. O
   CRUD administrativo (rotas admin de escrita e tela em `apps/admin`) fica para
   PR seguinte. O critério de aceite literal da Story é conteúdo editável via
   banco, o que esta entrega satisfaz.
5. **Tokens:** os valores exatos do handoff que faltam entram como tokens novos
   em `packages/design`. Os tokens existentes não são alterados, para não causar
   regressão visual nas outras telas.
6. **Fontes:** carregar os pesos Jost 500/600/700 que faltam. Cormorant Garamond
   fica de fora, porque só serve aos contadores da home do membro.

## Arquitetura

Ordem de execução: banco → contratos compartilhados → API → mobile.

```
packages/db        migration + seed do conteúdo institucional
packages/shared    schemas Zod do payload da home
apps/api           GET /api/home-content (unauthed)
packages/design    tokens de cor que faltam
apps/mobile        InicioScreen + componentes do handoff
```

## 1. Banco de dados (`packages/db`)

Migration: `20260819000000_home_content`.

### `HomeContent` (singleton)

| Campo | Tipo | Uso |
| --- | --- | --- |
| `id` | `String @id` | constante `HOME_CONTENT_SINGLETON_ID` |
| `heroTitle` | `VarChar(120)` | Seção 1, mote |
| `heroSubtitle` | `VarChar(200)?` | Seção 1 |
| `heroBannerObjectKey` | `VarChar(300)?` | banner principal em R2 |
| `institutionalTitle` | `VarChar(120)` | Seção 1 |
| `institutionalBody` | `VarChar(1000)` | texto institucional |
| `institutionalImageObjectKey` | `VarChar(300)?` | imagem institucional em R2 |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |

### `HomeBenefit` (Seção 2)

`id`, `icon VarChar(40)`, `title VarChar(80)`, `description VarChar(240)?`,
`active Boolean @default(true)`, `sortOrder Int @default(0)`, timestamps.
Índice: `@@index([active, sortOrder])`.

`icon` guarda uma chave de ícone resolvida no front. Chave desconhecida cai em um
ícone padrão, nunca quebra a renderização.

### `HomeHighlight` (Seção 6)

`id`, `kind HomeHighlightKind`, `title VarChar(80)`, `subtitle VarChar(140)?`,
`imageObjectKey VarChar(300)?`, `linkPath VarChar(200)?`,
`active Boolean @default(true)`, `sortOrder Int @default(0)`, timestamps.
Índice: `@@index([active, sortOrder])`.

```prisma
enum HomeHighlightKind {
  event
  day_use
  experience
  partner
}
```

`linkPath` é uma rota interna do app (ex.: `/events`). Nulo significa card
informativo, não clicável.

### Destaque de planos (Seção 5)

`PremiumPlan` já tem `active` (planos ativos) e `sortOrder` (ordem de exibição).
Adicionar **uma** coluna:

```prisma
homeFeatured Boolean @default(true)
```

É o "status de exibição" da Story. Nenhuma tabela de junção: a relação com
`PremiumPlan` é 1:1 e `tier` é `@unique`, então o número de planos é pequeno e
fixo.

### Seed

`prisma/seed.ts` ganha um bloco idempotente (`upsert`) que cria o singleton, os
benefícios e os destaques com o conteúdo inicial derivado do handoff. Rodar o
seed duas vezes não duplica linhas.

## 2. Contratos compartilhados (`packages/shared/src/home.ts`)

Arquivo novo, no padrão de `premium-catalog.ts` e `general-settings.ts`.

```
HOME_CONTENT_SINGLETON_ID
homeHighlightKindSchema
homeBenefitSchema          icon, title, description, sortOrder
homeHighlightSchema        kind, title, subtitle, imageUrl, linkPath, sortOrder
homePlanSchema             slug, name, description, fromAmountCents, currency, benefits[]
homeContentResponseSchema  { hero, institutional, benefits[], highlights[], plans[] }
```

Regras do contrato:

- `fromAmountCents` é o menor `baseAmountCents` entre os `PremiumPlanPrice`
  ativos do plano. É o "valor inicial" da Story. Plano sem preço ativo não entra
  na resposta.
- `benefits` do plano vem de `PremiumPlanBenefit`, ordenado por `sortOrder`,
  limitado aos 3 primeiros. O detalhe completo continua em `/api/plans` e na tela
  `/assinaturas`.
- `imageUrl` já sai resolvido pelo backend via `app.uploads.buildPublicUrl`,
  mesmo padrão de `coverUrl` em `events.ts`. O mobile nunca recebe `objectKey`.
- Nenhum id de provider (`stripePriceId`, `rcProductId`) é serializado, igual
  `premium-catalog.ts`.

## 3. API (`apps/api`)

### `src/services/home-content.ts`

`ensureHomeContent()` espelhando `ensureGeneralSettings()`: faz upsert do
singleton com defaults quando a linha não existir, e devolve a linha.

### `src/routes/home-content.ts`

```
GET /api/home-content
```

Plugin novo, **unauthed**, igual `premium-catalog.ts` e `store.ts`. A home é a
primeira tela e roda antes do login.

- Uma request devolve a tela inteira: hero, institucional, benefícios, destaques
  e planos.
- Rate limit por rota no padrão de `badges-catalog.ts`: `max: 60`,
  `timeWindow: '1 minute'`, `keyGenerator` por IP.
- **Sem cache em memória.** O critério de aceite é conteúdo editável no banco
  surtindo efeito sem republicar o app; um TTL atrasaria isso. Se virar problema
  de carga, o cache entra junto com o CRUD admin, que é quem sabe invalidar.
- Benefícios e destaques: `where active`, `orderBy sortOrder asc`.
- Planos: `PremiumPlan where active && homeFeatured`, `orderBy sortOrder asc`,
  include de prices ativos e benefits.
- `/api/plans` não é alterado. A Story pede consumir a estrutura de assinaturas
  existente, e é o que o serviço faz por dentro.

Registro em `src/app.ts` junto dos outros catálogos públicos.

### Teste de integração

`apps/api/test/home-content.route.test.ts`, Postgres real via os helpers
existentes. Casos:

- singleton ausente é criado com defaults na primeira leitura
- benefício com `active: false` não aparece
- destaques respeitam `sortOrder`
- plano com `homeFeatured: false` fica fora
- plano sem preço ativo fica fora
- `fromAmountCents` é o menor preço ativo
- `imageUrl` é nulo quando não há `objectKey`
- nenhum id de provider aparece na resposta

## 4. Tokens de design (`packages/design`)

Acrescentar em `src/tokens.ts` e espelhar em `tailwind-preset.cjs`, como o
próprio arquivo instrui:

| Token | Valor | Uso |
| --- | --- | --- |
| `goldDeep` | `#C9A227` | labels de seção, ícones de metalinha |
| `goldLight` | `#E8CE86` | topo do gradiente dourado |
| `surfaceGold` | `#0F0E0B` | fundo de card pequeno |
| `hairlineGold` | `rgba(212,175,55,0.14)` | borda padrão |
| `hairlineGoldStrong` | `rgba(212,175,55,0.28)` | borda de ênfase |

Os tokens existentes (`brandDeep`, `brandSoft`, `surface`) **não** são alterados,
para não causar regressão visual nas outras telas.

## 5. Fontes (`apps/mobile/app/_layout.tsx`)

Adicionar ao `useFonts`: `Jost_500Medium`, `Jost_600SemiBold`, `Jost_700Bold`.
Cormorant Garamond fica de fora nesta entrega.

## 6. Mobile (`apps/mobile`)

```
src/api/home.ts                        getHomeContent()
src/copy/inicio.ts                     labels PT-BR
src/screens/inicio/InicioScreen.tsx    orquestra, decide anon vs logado
src/screens/inicio/components/
  AppHeader.tsx           monograma + wordmark + ação à direita
  SectionLabel.tsx         label dourado 10px, letter-spacing .28em
  GoldPill.tsx             CTA pequeno, gradiente dourado, texto preto
  FeatureCard.tsx          card de destaque, fundo radial, borda dourada .28
  HeroSection.tsx          Seção 1
  BenefitsSection.tsx      Seção 2
  CtaSection.tsx           Seções 3 e 4
  PlansSection.tsx         Seção 5
  HighlightsSection.tsx    Seção 6
```

`app/welcome.tsx` passa a ser wrapper de uma linha: `<InicioScreen />`. A rota
não muda, então deep links, `PUBLIC_EXACT` e o roteamento existente seguem
válidos.

### Estado anon

As 6 seções na ordem da Story: apresentação, benefícios, CTA criar conta, CTA
assinar, planos, eventos e experiências.

### Estado logado

Mantém exatamente o que o membro vê hoje (próximo evento em destaque e eventos
secundários), apenas reacomodado dentro de `InicioScreen`. Nenhuma mudança
visual. Os componentes do handoff ficam prontos e compartilhados para a home do
membro na PR seguinte. Os contadores de "Status do clube" do handoff **não** são
implementados: dependem de um endpoint de contagem que não existe.

### Navegação dos CTAs

| Origem | Anon | Logado |
| --- | --- | --- |
| Seção 3, "Criar conta" | `/signup` | seção não renderiza |
| Seção 4, "Assinar" | `buildLoginHref('/assinaturas')` | `/assinaturas` |
| Seção 5, card de plano | `buildLoginHref('/assinaturas')` | `/assinaturas` |
| Seção 6, destaque com `linkPath` | push no path | push no path |

### Mudança obrigatória em `src/auth/redirect-intent.ts`

`/assinaturas` não está em `NEXT_ALLOWED_PREFIXES`. Sem incluir, o
`next=/assinaturas` é descartado pelo sanitizador e o usuário cai em `/garage`
depois do login, quebrando o critério de aceite da Seção 4. Adicionar o prefixo
mais um teste que cubra o caminho.

`/assinaturas` **não** entra em `PUBLIC_EXACT`: a Story manda seguir o fluxo de
login/cadastro da aplicação para usuário não autenticado.

### Estados de carregamento e erro

- **Loading:** skeleton nos formatos reais por bloco (hero, faixa de benefícios,
  cards de plano, cards de destaque). Nunca spinner de tela cheia.
- **Erro:** a home é uma request única, então a falha é total. Uma linha de erro
  com botão de tentar novamente, no padrão de `HeroError` no welcome atual.
- **Vazio:** seção sem itens ativos simplesmente não renderiza. A tela nunca
  mostra um cabeçalho de seção sem conteúdo abaixo.

### Ícones

`lucide-react-native`, que já é o sistema do app. Os nomes Material do handoff
são mapeados numa tabela única no front (`notifications` → `Bell`,
`calendar_today` → `Calendar`, `directions_car` → `Car`, `sell` → `Tag`, e assim
por diante). Chave desconhecida cai no ícone padrão.

### Animação de entrada

Fade mais `translateY` de 10px em 320ms, respeitando "reduzir movimento" do
sistema: com a preferência ligada, só o fade.

### Testes

- `src/screens/inicio/__tests__/InicioScreen.test.tsx`: anon renderiza as 6
  seções; logado não renderiza as seções de vitrine; loading mostra skeleton;
  erro mostra retry; seção vazia não renderiza cabeçalho.
- `src/api/__tests__/home.contract.test.ts`: o payload do backend satisfaz
  `homeContentResponseSchema`, no padrão de `events.contract.test.ts`.
- `redirect-intent`: `next=/assinaturas` sobrevive ao sanitizador.

## Fora de escopo

- CRUD administrativo do conteúdo institucional (rotas admin de escrita e tela
  em `apps/admin`).
- Upload das imagens de banner e institucional pelo admin. Nesta entrega os
  `objectKey` são preenchidos por seed ou direto no banco.
- Home do membro logado conforme o handoff (hero, saudação, status do clube,
  acesso rápido) e o endpoint de contadores do clube.
- Modelos de domínio `DayUse` e `Experience`.
- Tab bar do handoff. O app não usa tab bar hoje e a Story não pede.
- Pull-to-refresh.

## Critérios de aceite

| # | Critério | Verificação |
| --- | --- | --- |
| 1 | Anon entende a proposta do clube na primeira tela | Seção 1 renderiza hero, título e texto institucional vindos do banco |
| 2 | Diferenciais da assinatura visíveis | Seção 2 renderiza `HomeBenefit` ativos, ordenados |
| 3 | Anon inicia o cadastro pela tela inicial | CTA da Seção 3 navega para `/signup` |
| 4 | Anon é direcionado à jornada de assinatura | CTA da Seção 4 leva a login com `next=/assinaturas` e, após autenticar, aterrissa em `/assinaturas` |
| 5 | Visão rápida dos planos | Seção 5 mostra nome, valor inicial e até 3 benefícios dos planos com `active && homeFeatured` |
| 6 | Destaques do clube antes do cadastro | Seção 6 renderiza `HomeHighlight` ativos, ordenados |
| 7 | Conteúdo dinâmico sem republicar o app | Alterar uma linha no banco muda a tela na próxima abertura, sem build novo |
| 8 | Estado logado intacto | Teste do estado logado passa sem mudança visual |
