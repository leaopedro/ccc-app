# Feed da comunidade na Início

Data: 2026-09-13
Status: aprovado; revisado por quatro revisores adversariais em 2026-09-13

## Problema

A tela de Início não mostra nada do feed. O feed existe, mas vive preso
dentro da página de cada evento (`apps/mobile/app/(app)/events/[slug].tsx:348`),
no fim de uma página longa. Quem abre o app não vê que há conversa acontecendo.

## Objetivo

Uma seção na Início com alguns posts sorteados de eventos públicos. Tocar num
card leva para a página daquele evento, já rolada até o feed.

## Decisões

| Questão          | Decisão                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Quem vê          | Todo mundo, inclusive anônimo. Guest e Member.                           |
| De quais eventos | Só `feedAccess: 'public'` E `status: 'published'` E `feedEnabled: true`. |
| Sorteio          | Embaralha os 50 posts elegíveis mais recentes, corta em N.               |
| Quantidade       | Configurável no admin, campo novo em `HomeContent`. Default 5.           |
| Destino do toque | `/events/[slug]` com scroll automático até o feed.                       |
| Formato          | Carrossel horizontal, card texto-first.                                  |

A escolha de "só `public`" é o ponto load-bearing. `Event.feedAccess` tem
default `attendees`, e `checkFeedReadAccess`
(`apps/api/src/services/feed/access.ts:23`) exige `Ticket` com `status: 'valid'`
nesse modo. Um feed na Início que ignorasse isso publicaria para anônimos
conteúdo que a API hoje garante ser de portador de ingresso.

Consequência aceita: a seção nasce vazia. Só enche quando alguém marcar
eventos como `public` no admin.

## Elegibilidade de um post

Um post entra no sorteio quando TODAS as condições valem. Cada linha tem um
motivo próprio; nenhuma é decorativa.

| Condição                                           | Por quê                                                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FeedPost.status = 'visible'`                      | `hidden` e `removed` são os dois estados de moderação. O soft delete grava `removed` (`routes/feed.ts:543`).                                                                                                |
| `Event.feedEnabled = true`                         | O organizer desligou o feed daquele evento.                                                                                                                                                                 |
| `Event.feedAccess = 'public'`                      | `attendees` exige ticket, `members_only` exige premium. Nenhum pode alimentar tela anônima.                                                                                                                 |
| `Event.status = 'published'`                       | Toda leitura pública de evento filtra isso (`routes/events.ts:172`, `:213`). Sem essa linha, o `slug` e o `title` de um evento em rascunho aparecem na primeira tela do app, e o toque no card cai num 404. |
| Autor sem `FeedBan` naquele evento                 | `FeedBan` não mexe em `FeedPost.status` (`routes/admin/feed-moderation.ts:245`). Sem esse filtro, banir um assediador às 22h deixa o conteúdo dele sendo promovido à primeira tela do app.                  |
| Nenhum `Report` com `status: 'open'`               | O auto-hide só dispara com 3 denunciantes distintos (`services/feed/report.ts:13`). Um post com 2 denúncias abertas é tolerável dentro do evento; na vitrine do app, não.                                   |
| Autor existe E está em conta `active`              | Ver "Conta apagada", abaixo. O `not: null` sozinho NÃO basta.                                                                                                                                               |
| Autor não bloqueado pelo leitor, nos dois sentidos | Guideline 1.2 da App Store.                                                                                                                                                                                 |
| Evento sem `FeedBan` scope `view` para o leitor    | Mesma regra que `checkFeedReadAccess` aplica.                                                                                                                                                               |

### Conta apagada

`services/account-deletion/anonymize.ts:107` preserva o `body` do post e anula
`authorUserId`. No feed do evento isso é certo: mantém a thread íntegra, e a
audiência já é restrita àquele evento.

Na Início não há thread, só promoção. Um post de quem exerceu o direito de
eliminação viraria destaque na primeira tela do app, servido a anônimo.

**Excluir `authorUserId: null` não é suficiente, e essa foi a primeira versão
errada deste spec.** A anulação do autor não acontece no pedido de exclusão:
`services/account-deletion/request.ts:19-36` só marca `status: 'deleted'` e
grava `deletedAt`, e o worker (`workers/account-deletion.ts:26-27`) só anonimiza
quem tem `deletedAt <= now - DELETION_GRACE_DAYS`, que é 30 por padrão
(`env.ts:68`). Durante esses 30 dias `authorUserId` continua preenchido, e o
post, o apelido e a foto do carro continuariam elegíveis para a vitrine. É
exatamente o dano que esta seção existe para impedir, atrasado um mês. O mesmo
buraco cobre `status: 'disabled'`, ou seja, conta banida da plataforma.

Por isso a regra real é mais forte: o autor precisa existir E estar em conta
`active`. A rota resolve isso com uma consulta a `User` sobre os autores do
pool, ao lado da consulta de `FeedBan`, e descarta quem não estiver ativo.
Excluir `partial` de passagem é conservador e aceito.

O `not: null` continua no `where` porque ele é barato e coabita com o `notIn`
do filtro de bloqueio na mesma chave. Mas ele é otimização, não a salvaguarda.

Isso é o oposto do que a rota por evento faz, e a diferença é deliberada. Lá, o
ramo `OR: [{ authorUserId: null }, ...]` existe porque `NULL NOT IN (...)`
avalia para NULL e derrubaria esses posts sem querer (`routes/feed.ts:70-77`).

**Obrigação que viaja com esta entrega:** `docs/ropa.md` COMM-01 descreve a
salvaguarda como "controle de acesso por evento". A rota nova não passa por
`checkFeedReadAccess`, e a categoria de destinatário passa a incluir público
anônimo. `docs/ropa.md` e `LGPD_scan.md:134` precisam ser atualizados no mesmo
PR, não depois.

## Dados

Um campo no singleton `HomeContent` (`packages/db/prisma/schema.prisma:2085`):

```prisma
feedPostCount Int @default(5)
```

Nenhum model novo. O sorteio não persiste nada.

`min(0)` na validação é de propósito: zero desliga a seção sem flag separada.
Como zero é um estado válido, campo vazio no form NÃO pode coagir para zero —
ver "Admin".

## API

### `GET /api/home-feed`

Público. Usa `app.tryAuth`, não `app.authenticate`, para poder filtrar
bloqueios de quem está logado sem exigir login.

Sem query param de quantidade. O servidor lê `HomeContent.feedPostCount`. A
configuração fica num lugar só, e a URL não aceita pedido de 500 posts.

Montagem:

1. Em paralelo: `ensureHomeContent()`, os ids de evento elegível, os ids de
   autor bloqueado (`blockedUserIdsFor`), e os `FeedBan` scope `view` do leitor.
2. Se `feedPostCount <= 0` ou não há evento elegível, responde `{ posts: [] }` e
   sai. O early return não é otimização cosmética: ver "Custo da query".
3. Busca os `HOME_FEED_POOL_SIZE = 50` posts mais recentes que satisfazem a
   tabela de elegibilidade, com `eventId: { in: <ids elegíveis> }`. Ordenação
   total `[{ createdAt: 'desc' }, { id: 'desc' }]`.
4. Descarta os posts cujo par `(eventId, authorUserId)` tem `FeedBan`.
5. Embaralha em memória (Fisher-Yates) e corta em `feedPostCount`.

### Custo da query

Medido em Postgres 16 com 400 mil posts e 300 eventos, índices idênticos aos do
schema.

`FeedPost` tem `@@index([eventId, createdAt(sort: Desc)])` e
`@@index([status, createdAt])`. `Event` **não tem índice em `feedAccess` nem em
`feedEnabled`**.

Filtrar por relação (`where: { event: { feedAccess: 'public' } }`) vira um
semi-join que o planner resolve varrendo `[status, createdAt]` de trás para
frente até achar 50 linhas que casem. Com zero eventos públicos — o estado
inicial desta feature — são 392 mil linhas percorridas e 9.127 buffers para
devolver lista vazia, em toda request de toda pessoa que abre o app:

```
Limit  (actual time=83.838..83.839 rows=0)
  Buffers: shared hit=9127
Execution Time: 83.872 ms
```

Resolver os ids elegíveis numa query separada e usar `eventId: { in: [...] }`
troca isso pelo índice `[eventId, createdAt desc]`:

```
Limit  (rows=50)  Buffers: shared hit=63
Execution Time: 1.093 ms
```

63 buffers contra 9.127. A lista de eventos elegíveis é pequena e cabe em
memória; se um dia não couber, aí sim o assunto é índice novo em `Event`.

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

A resposta nunca carrega `authorUserId`; a autoria vem de `isOwn` calculado no
servidor (`false` para anônimo).

`homeFeedItemSchema` entra em `FEED_PUBLIC_RESPONSE_SCHEMAS`
(`packages/shared/src/feed.ts:202`). Mas atenção ao que isso prova: o teste de
contrato (`packages/shared/src/__tests__/feed-privacy-contract.test.ts:56`) só
compara as chaves declaradas do schema contra `FEED_FORBIDDEN_RESPONSE_KEYS`
(`plate`, `email`, `phone`, `cpf`, `userId`, `ownerId`, `address`). Ele nunca
toca numa rota e não sabe nada sobre `slug` de evento em rascunho. O controle
real é a asserção de payload no teste de integração. Não tratar o contrato como
o gate.

### Rate limit

60 requests por minuto por `req.ip`, seguindo `GET /api/home-content`.

Com uma ressalva que precisa estar escrita: `trustProxy` não está ligado em
`apps/api/src/app.ts:98`, então atrás do Railway `req.ip` é o endereço do proxy
para todo mundo e a chave colapsa num balde global. O repo já documenta isso em
`apps/api/src/routes/premium-catalog.ts:78-95` e por isso usa um teto alto lá.

Decisão: chavear por `request.user?.sub` quando houver e cair para IP, com teto
de 6000/min no molde de `premium-catalog.ts`. Ligar `trustProxy` é a correção
certa, vale para a API inteira e exige validar `x-forwarded-for` para o balde
não virar falsificável. Fica fora desta entrega, registrado como follow-up.

### Por que rota separada

Não tem `eventId`, a regra de acesso é outra, e a resposta carrega o evento
junto. Estender `/events/:eventId/feed` misturaria dois modelos de autorização
dentro de `checkFeedReadAccess`, que é a peça que garante o gate por ingresso.

## Admin

- `packages/shared/src/admin-home.ts`: `feedPostCount` na leitura (com
  `.default(5)`, para o admin na Vercel não quebrar se deployar antes da API no
  Railway) e na escrita, faixa `0..20`.
- Campo vazio no form significa "não alterar", nunca zero. `z.coerce.number()`
  puro transforma `''` em `0`, e como zero desliga a seção, o organizer que
  limpa o campo para redigitar e clica Salvar apaga a seção da Início de todo
  mundo, com 200 e sem aviso. O schema precisa de um `preprocess` que mapeie
  string vazia para `undefined`, no molde do `optionalText` que já existe em
  `admin-home.ts:42`.
- `apps/api/src/routes/admin/home-content.ts`: `'feedPostCount'` em
  `CONTENT_FIELDS` e no serializer.
- Auditoria: `recordAudit` hoje grava só o nome do campo tocado
  (`admin/home-content.ts:128`); o antes/depois existe só para `IMAGE_FIELDS`.
  `feedPostCount` controla quanto UGC vai para a vitrine do app, então grava
  `{ previous, next }` no mesmo molde.
- `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`: um
  `<input type="number">` num bloco "Feed da comunidade".

## Mobile

### Dados

- `src/api/home-feed.ts` com `listHomeFeed()`.
- `src/hooks/useHomeFeed.ts` com `useState`/`useEffect`. Segue o padrão do repo;
  o app não usa react-query.

`listHomeFeed` usa `authedRequest` com fallback para `request`, exatamente o
idiom de `listFeedPosts` (`apps/mobile/src/api/feed.ts:23-38`). Isso é
load-bearing, não estilo: `request` só manda `authorization` se receber um
token explícito (`src/api/client.ts:34-41`). Com a chamada anônima,
`request.user` é sempre `undefined` no servidor, `blockedUserIdsFor(null)`
devolve `[]`, e o filtro de bloqueio nunca roda em produção — enquanto os
testes da API, que injetam o header na mão, ficam verdes. O membro que bloqueou
um assediador continuaria vendo os posts dele na primeira tela do app.

### Seção

- `src/screens/inicio/sections/CommunityFeedSection.tsx` e
  `src/screens/inicio/components/FeedTeaserCard.tsx`.
- Carrossel horizontal. Card: nome do evento no topo, três linhas do corpo,
  carro autor com foto pequena no rodapé. Post com foto usa a foto como fundo,
  sob um `LinearGradient` de três paradas igual ao `HeroSection` — um scrim
  chapado de 86% apagaria a foto que ele deveria realçar.
- A seção some por completo quando a lista vem vazia.
- Renderizada em `GuestHome` e `MemberHome`. Posição: no member, depois do
  `NextEventCard`; no guest, depois do `HighlightsSection`.
- `refreshAll()` do `MemberHome` passa a refazer o fetch do feed, e o
  `refreshing` do `RefreshControl` passa a incluir o loading do feed.
- `accessibilityLabel` inclui o corpo do post. Um `Pressable` colapsa os filhos
  num nó só, então um label que diz apenas "Post em X" silencia o conteúdo
  inteiro para leitor de tela.
- Altura mínima, não fixa, e `maxFontSizeMultiplier` nos `Text`. `lineHeight`
  de `StyleSheet` não escala com Dynamic Type, e abaixo da altura natural do
  glifo o topo do texto é cortado no iOS.

O card é texto-first porque `FeedComposerSheet.onSubmit` só passa `(body, carId)`
hoje. Nenhum call site do mobile envia `photoObjectKeys`.

### Navegação e scroll

```ts
router.push({ pathname: '/events/[slug]', params: { slug, focus: 'feed' } } as never);
```

Em `apps/mobile/app/(app)/events/[slug].tsx`: `ref` no `ScrollView` da linha 215,
`onLayout` na `View` que envolve o `EventFeedSection`, e um efeito que rola até
lá.

A guarda de disparo único tem que ser latcheada DENTRO do callback do timer, não
antes dele. `event` é `commerceEvent ?? publicEvent` (`[slug].tsx:101`), e
`getEventCommerce` resolve depois de `getEvent`: latchear antes faria o cleanup
do efeito cancelar o `setTimeout` enquanto a guarda já bloqueia a reexecução, e
o scroll nunca aconteceria.

## Testes

API, integração contra Postgres real:

- post de evento `public` + `published` aparece;
- post de evento `attendees` não aparece;
- post de evento `draft` não aparece;
- post de evento `cancelled` não aparece;
- post `hidden` e post `removed` não aparecem;
- post com `Report` aberto não aparece;
- post de autor com `FeedBan` naquele evento não aparece;
- post de autor deletado (`authorUserId: null`) não aparece;
- post de autor bloqueado, nos dois sentidos, não aparece;
- leitor com `FeedBan` scope `view` não recebe post daquele evento;
- `feedPostCount` respeitado; `feedPostCount: 0` devolve lista vazia;
- resposta nunca contém `authorUserId`;
- o sorteio sorteia: com 20 posts e `feedPostCount: 3`, a união de várias
  chamadas tem mais de 3 ids distintos. Sem esse teste, trocar
  `shuffle(pool).slice(0, N)` por `pool.slice(0, N)` passa em tudo.

Admin: teste de interação do form e testes de PUT, incluindo o caso do campo
vazio.

Mobile: teste do client asserindo que `authedRequest` foi chamado (não só o
path), e render da seção incluindo o caso vazio.

## Fora de escopo

Achados que ficam registrados e não entram nesta entrega:

1. `DELETE /events/:eventId/feed/:postId/reactions` não existe na API. O mobile
   chama em `apps/mobile/src/api/feed.ts:74` e o 404 é engolido em
   `EventFeedSection.tsx:156`, mas o estado local já decrementou.
2. Upload de foto no composer do mobile está morto. A API aceita
   `photoObjectKeys`, nenhum call site do mobile envia.
3. `trustProxy` desligado torna todo rate limit por IP um balde global.
4. `CarPhoto.sortOrder` tem default 0 e a escolha da foto primária não desempata
   por id. Corrigido de passagem na extração do serializador, porque é uma linha;
   o resto da classe de bug continua no repo.
5. Pool global de 50: um evento com muito movimento pode ocupar o pool inteiro e
   esconder os demais eventos públicos até o movimento passar.
6. O sorteio é por request, então pull-to-refresh troca os cards. Consequência
   conhecida da decisão de sorteio, não defeito.
