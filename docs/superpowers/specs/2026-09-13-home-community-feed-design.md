# Feed da comunidade na Início

Data: 2026-09-13
Status: aprovado, pronto para plano de implementação

## Problema

A tela de Início não mostra nada do feed. O feed existe, mas vive preso
dentro da página de cada evento (`apps/mobile/app/(app)/events/[slug].tsx:349`),
no fim de uma página longa. Quem abre o app não vê que há conversa acontecendo.

## Objetivo

Uma seção na Início com alguns posts sorteados de eventos públicos. Tocar num
card leva para a página daquele evento, já rolada até o feed.

## Decisões

| Questão | Decisão |
|---|---|
| Quem vê | Todo mundo, inclusive anônimo. Guest e Member. |
| De quais eventos | Só eventos com `feedAccess: 'public'`. Sem exceção ao gate existente. |
| Sorteio | Embaralha os 50 posts públicos mais recentes, corta em N. |
| Quantidade | Configurável no admin, campo novo em `HomeContent`. Default 5. |
| Destino do toque | `/events/[slug]` com scroll automático até o feed. |
| Formato | Carrossel horizontal, card texto-first. |

A escolha de "só `public`" é o ponto load-bearing. `Event.feedAccess` tem
default `attendees`, e `checkFeedReadAccess`
(`apps/api/src/services/feed/access.ts:23`) exige `Ticket` com `status: 'valid'`
nesse modo. Um feed na Início que ignorasse isso publicaria para anônimos
conteúdo que a API hoje garante ser de portador de ingresso.

Consequência aceita: a seção nasce vazia. Só enche quando alguém marcar
eventos como `public` no admin.

## Dados

Um campo no singleton `HomeContent` (`packages/db/prisma/schema.prisma:2085`):

```prisma
feedPostCount Int @default(5)
```

Nenhum model novo. O sorteio não persiste nada.

`min(0)` na validação é de propósito: zero desliga a seção sem flag separada.

## API

### `GET /api/home-feed`

Público. Usa `app.tryAuth`, não `app.authenticate`, para poder filtrar
bloqueios de quem está logado sem exigir login.

Sem query param de quantidade. O servidor lê `HomeContent.feedPostCount`. A
configuração fica num lugar só, e a URL não aceita pedido de 500 posts.

Montagem:

1. Com usuário logado, resolve antes da query os ids de `blockedUserIdsFor` e
   os `eventId` onde ele tem `FeedBan` scope `view`. Anônimo pula esta etapa.
2. Busca os `HOME_FEED_POOL_SIZE = 50` posts mais recentes com
   `status: 'visible'`, `event.feedEnabled: true`, `event.feedAccess: 'public'`
   e os filtros do passo 1 já no `where`. Ordenação total
   `[{ createdAt: 'desc' }, { id: 'desc' }]`, o mesmo cuidado documentado em
   `apps/api/src/routes/feed.ts:149`.
3. Embaralha em memória e corta em `feedPostCount`. Sem `ORDER BY random()`:
   mantém index scan e não degrada conforme a tabela cresce.

Filtrar dentro do `where`, não depois do fetch, é load-bearing. Filtrar os 50
já trazidos encolheria o pool e devolveria menos de `feedPostCount` posts para
quem tem muitos bloqueios.

O filtro de block precisa da mesma forma de `feed.ts:136-138`:

```ts
OR: [{ authorUserId: null }, { authorUserId: { notIn: blockedIds } }]
```

Sem o ramo `null`, `NULL NOT IN (...)` sumiria com posts de autores deletados.

Rate limit por IP, igual `GET /api/home-content` (`routes/home-content.ts:61`).

### Resposta

Em `packages/shared/src/feed.ts`, reusando o schema que já existe:

```ts
export const homeFeedItemSchema = feedPostResponseSchema.extend({
  event: z.object({ slug: z.string(), title: z.string() }),
});

export const homeFeedResponseSchema = z.object({
  posts: z.array(homeFeedItemSchema),
});
```

Contrato de privacidade mantido: a resposta nunca carrega `authorUserId`, e a
autoria continua vindo de `isOwn` calculado no servidor (`false` para anônimo).
`homeFeedItemSchema` entra em `FEED_PUBLIC_RESPONSE_SCHEMAS`
(`packages/shared/src/feed.ts:202`) para o teste de contrato cobrir a rota nova.

### Por que rota separada

Não tem `eventId`, a regra de acesso é outra (só `public`, nunca ticket), e a
resposta carrega o evento junto. Estender `/events/:eventId/feed` para isso
misturaria dois modelos de autorização dentro de `checkFeedReadAccess`, que é
justamente a peça que garante o gate por ingresso.

## Admin

- `packages/shared/src/admin-home.ts`: `feedPostCount: z.number().int().min(0).max(20).optional()`
  em `homeContentUpdateSchema`, e o campo no schema de leitura.
- `apps/api/src/routes/admin/home-content.ts`: `'feedPostCount'` em
  `CONTENT_FIELDS` e no `serializeAdminHomeContent`. O loop de diff, o
  `expectedUpdatedAt` e a auditoria já cobrem o campo sem código novo.
- `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`: um
  `<input type="number">` num bloco "Feed da comunidade", mesmo padrão dos
  campos existentes.

## Mobile

### Dados

- `src/api/home-feed.ts` com `listHomeFeed()`, validando `homeFeedResponseSchema`.
- `src/hooks/useHomeFeed.ts` com `useState`/`useEffect`. Segue o padrão do repo;
  o app não usa react-query.

### Seção

- `src/screens/inicio/sections/CommunityFeedSection.tsx` e
  `src/screens/inicio/components/FeedTeaserCard.tsx`.
- Carrossel horizontal. Card: nome do evento no topo, três linhas do corpo,
  carro autor com foto pequena no rodapé. Post com foto usa a foto como fundo.
- A seção some por completo quando a lista vem vazia. Sem placeholder fantasma.
- Renderizada em `GuestHome` e `MemberHome`. Posição: no member, depois do
  `NextEventCard`; no guest, depois do `HighlightsSection`.
- `refreshAll()` do `MemberHome` passa a refazer o fetch do feed.

O card é texto-first porque `FeedComposerSheet.onSubmit` só passa `(body, carId)`
hoje. Nenhum call site do mobile envia `photoObjectKeys`, então post com foto é
a exceção, não a regra.

### Navegação e scroll

```ts
router.push({ pathname: '/events/[slug]', params: { slug, focus: 'feed' } })
```

Em `apps/mobile/app/(app)/events/[slug].tsx`: `ref` no `ScrollView` da linha 215,
`onLayout` na `View` que envolve o `EventFeedSection` guardando o `y`, e um
efeito que rola até lá quando `focus === 'feed'` e o evento já carregou. Guarda
de disparo único por ref: sem ela, cada re-render rebobina o scroll.

## Testes

API, integração contra Postgres real:

- post de evento `public` aparece;
- post de evento `attendees` não aparece;
- post de autor bloqueado não aparece;
- usuário com `FeedBan` scope `view` não recebe post daquele evento;
- post de autor deletado (`authorUserId: null`) continua aparecendo para quem
  tem bloqueios ativos;
- `feedPostCount` respeitado;
- `feedPostCount: 0` devolve lista vazia;
- resposta nunca contém `authorUserId`.

Admin: teste de interação do form, no molde de
`home-content-form.interaction.test.tsx`.

Mobile: teste do client e render da seção, incluindo o caso vazio.

## Fora de escopo

Dois bugs achados durante o mapeamento do feed. Ficam registrados, não entram
nesta entrega:

1. `DELETE /events/:eventId/feed/:postId/reactions` não existe na API. O mobile
   chama em `apps/mobile/src/api/feed.ts:74` e o 404 é engolido em
   `EventFeedSection.tsx:156`, mas o estado local já decrementou. A UI mostra
   descurtido e o servidor mantém o like até o próximo fetch.
2. Upload de foto no composer do mobile está morto. A API aceita
   `photoObjectKeys` em create e patch, nenhum call site do mobile envia.
