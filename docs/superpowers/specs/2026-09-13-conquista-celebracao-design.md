# Celebração de conquista

Data: 2026-09-13
Status: aprovado em brainstorm, pronto para plano

## Problema

Ganhar uma conquista hoje é invisível. O usuário posta uma foto, faz check-in
ou cadastra um carro, a `GarageBadge` é criada na mesma transação, e nada
acontece na tela. Ele só descobre se abrir a garagem e reparar num hexágono
novo.

Três coisas bloqueiam o feedback:

1. `awardBadge` (`apps/api/src/services/garage/awarder.ts:59`) só emite a linha
   de `Notification` quando o chamador passa `notifyOnGrant: true`. Só o grant
   manual do admin passa (`apps/api/src/routes/admin/user-garage.ts:417`). Os
   quatro caminhos automáticos (`cars.ts:90`, `feed.ts:368`,
   `auth/signup.ts:72`, `tickets/check-in.ts:100`) são silenciosos de
   propósito.
2. `badge_awarded` está explicitamente **fora** do worker de entrega de push
   (`apps/api/src/workers/notification-delivery.ts:16-23`), com o comentário
   dizendo que a entrega foi adiada.
3. Não existe nenhum estado que distinga "conquista que o usuário já viu
   celebrada" de "conquista nova". Sem isso, qualquer animação ou repete para
   sempre ou depende do aparelho.

## O que vamos entregar

Com o app aberto: a tela escurece, a conquista sobe com o texto, e a linha
aparece na central de notificações. Sem banner de push.

Com o app fechado: push na bandeja do sistema, mais a linha na central. Tocar
no push abre o app e a mesma animação sobe.

## Escopo

Dentro: campo de controle no banco, notificação em todos os caminhos de
concessão, entrega de push para `badge_awarded`, duas rotas novas, o overlay
animado no mobile e o gatilho que o dispara.

Fora, e deliberadamente:

- Som, haptics e confete.
- Preferência de usuário para desligar a animação.
- Celebração de XP ou de mudança de nível. Só conquista.
- Respeitar a preferência `transactional` de `/me/push-preferences`. O worker
  de entrega não consulta essa preferência para nenhum kind hoje
  (`apps/api/src/services/push/transactional.ts:104-108` lê todos os
  `DeviceToken` do usuário). Conquista segue o mesmo caminho dos demais
  transacionais. Mudar isso é outro projeto, e mudaria o comportamento de
  ticket e caixa junto.

## Decisões do brainstorm

| Questão                               | Decisão                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Como evitar o banner com o app aberto | Push sempre. O app suprime o banner em foreground. Sem estado de presença no servidor. |
| O que marca como já celebrada         | Campo no servidor mais rota de ack.                                                    |
| Conteúdo do overlay                   | Badge, título, descrição e CTA. Sem auto-dismiss.                                      |
| Várias conquistas de uma vez          | Uma tela só, com todas.                                                                |

## 1. Modelo

`GarageBadge` (`packages/db/prisma/schema.prisma:347-364`) ganha um campo:

```prisma
celebratedAt DateTime?
```

mais `@@index([garageId, celebratedAt])`.

`celebratedAt = null` significa "pendente de celebração". É a fila inteira.
Não há tabela nova.

### O backfill não é opcional

A migration precisa rodar, no mesmo arquivo:

```sql
UPDATE "GarageBadge" SET "celebratedAt" = "earnedAt";
```

Sem isso, todo usuário que já tem conquistas abre o app depois do deploy e
recebe a fila histórica inteira de uma vez. O backfill fecha a fila em todo
mundo que existe hoje, e só concessões posteriores ao deploy celebram.

## 2. API

### 2.1 Notificar em todos os caminhos

`AwardBadgeOptions.notifyOnGrant` passa a ter default `true`. Os quatro hooks
de write deixam de ser silenciosos sem precisar tocar em nenhum dos quatro
arquivos chamadores.

O bloco de notificação (`awarder.ts:163-199`) já está protegido por savepoint
próprio (`SAVEPOINT awardbadge_notify`) e já engole a colisão de `dedupeKey`.
Nada nessa mecânica muda: só o default do flag e os comentários que documentam
o silêncio como intencional (`awarder.ts:45-58` e `:163-166`).

A linha de `Notification` ganha `destination: { kind: 'internal_path', path:
'/garage' }`, para que o toque na central leve à garagem.
`notificationDestinationSchema` já aceita esse formato
(`packages/shared/src/notifications.ts:32-40`) e `openDestination` do mobile já
o resolve.

### 2.2 Rotas novas

Registradas em `apps/api/src/routes/garage.ts`, no mesmo padrão de escopo com
rate limit usado pelo bloco de `/me/garage/badges` (`garage.ts:357-380`).

**`GET /me/garage/badges/celebrations`** — 60/min/usuário.

```json
{ "enabled": true, "pending": [{ "code": "EVT-001", "earnedAt": "..." }] }
```

Filtra `celebratedAt: null` do garage do usuário, ordena por `earnedAt` asc e
desempata por `badgeCode` asc, teto de 10. Ordenação total de propósito: sem o
desempate, duas conquistas concedidas na mesma transação têm `earnedAt`
idêntico e a ordem vira não determinística entre chamadas.

Killswitch desligado devolve `{ enabled: false, pending: [] }`, igual ao
`/me/garage/badges`.

O payload carrega só `code` e `earnedAt`. Título, descrição, raridade e ícone
vêm do `/badges/catalog`, que já existe, já tem cache de 5 min e já é a fonte
editável pelo admin (`apps/api/src/routes/badges-catalog.ts`). Duplicar a copy
aqui criaria uma segunda fonte que sai de sincronia com
`/configuracoes/conquistas`.

**`POST /me/garage/badges/celebrations/ack`** — 20/min/usuário.

Body `{ "codes": ["EVT-001"] }`, no máximo 10, cada um validado por
`badgeCodeSchema`. Faz `updateMany` com `celebratedAt: now()` onde `garageId` é
do usuário, `badgeCode` está na lista e `celebratedAt` é null. Responde
`{ "acked": n }`. Idempotente: um segundo ack com os mesmos códigos devolve `0`
e não é erro.

Não faz ack em código que o usuário não tem. O `where` por `garageId` já
garante isso.

### 2.3 Schemas compartilhados

`packages/shared/src/badges.ts` ganha `badgeCelebrationsResponseSchema` e
`badgeCelebrationsAckRequestSchema` / `...ResponseSchema`.

## 3. Push

`badge_awarded` entra em duas listas:

- `pushKindSchema` (`packages/shared/src/push.ts:23-31`).
- `DELIVERABLE_KINDS` (`notification-delivery.ts:16-23`), junto com a correção
  do comentário logo acima, que hoje afirma que `badge_awarded` é inbox-only.

Nada mais muda na entrega. `buildPushDataFromRow` (`transactional.ts:27-34`) já
injeta `route: 'notifications'` e o `notificationId`, e o `destination` da
seção 2.1 vai junto no payload.

### O banner em foreground já está suprimido

O app não registra `setNotificationHandler` em lugar nenhum. O default do
expo-notifications é não apresentar a notificação com o app em foreground. Ou
seja, o comportamento pedido é o atual, por omissão.

Isso é frágil: um `setNotificationHandler` adicionado depois por outro motivo
quebra o requisito em silêncio. A defesa é um teste que falha se o handler
aparecer com `shouldShowAlert: true`, não código novo.

## 4. Mobile

### 4.1 Onde vive

`BadgeCelebrationProvider` montado em `apps/mobile/app/(app)/_layout.tsx`,
envolvendo `AppTabs` por dentro do `CartProvider`. O overlay renderiza acima
das tabs, então ele sobe em cima de qualquer tela, inclusive da central de
notificações onde o toque do push aterrissa.

O componente visual puro `BadgeCelebration` vai para `packages/ui`, ao lado de
`HexBadge` e `BadgeDetail`, e recebe as entradas já resolvidas por props. O
fetch, a fila e o ack ficam no container do mobile.

### 4.2 Gatilhos

Quatro, de propósito redundantes:

1. Montagem do provider. Cobre cold start e o toque no push que abre o app.
2. `AppState` voltando para `active`. Cobre o retorno do background.
3. `Notifications.addNotificationReceivedListener`. Dispara na hora quando o
   push chega com o app aberto.
4. Um timer de 60s dentro do provider, no mesmo intervalo que `useUnreadCount`
   (`apps/mobile/src/hooks/useUnreadCount.ts:5`) já usa para a central. Timer
   próprio, não um gancho no hook existente: o `useUnreadCount` vive dentro de
   `useFocusEffect` e só roda enquanto a tela dele está em foco.

O gatilho 3 depende de permissão de push concedida. Quem negou a permissão
continua recebendo a animação pelos gatilhos 1, 2 e 4. Na web, onde
`expo-notifications` não funciona, sobram 1, 2 e 4 também.

### 4.3 Conteúdo

Com uma conquista: hexágono `lg`, "NOVA CONQUISTA!", título, descrição, botão
"Ver conquista".

Com N: hexágonos `md` lado a lado, "VOCÊ GANHOU N CONQUISTAS", os títulos em
lista, botão "Ver conquistas".

O CTA leva para `/garage` com a `BadgesSheet` aberta. Com uma conquista, abre
direto no detalhe dela.

Fundo escurecido, sem auto-dismiss. Fecha no botão, no toque fora, ou no botão
voltar do Android.

### 4.4 Animação

`Animated` da React Native. Não há `react-native-reanimated` nem `moti`
instalados, e `Animated` já é o que `BudgetMeter.tsx` e `FeedComposerSheet.tsx`
usam.

Backdrop com fade de opacidade. Hexágonos com `translateY` de baixo para cima
mais `Animated.spring` na escala, em stagger quando há mais de um.
`useNativeDriver: true` nas duas, que são propriedades suportadas.

### 4.5 Ack

Sai ao **fechar** o overlay, não ao abrir.

Se o app morrer no meio da animação, ela volta na próxima abertura. Repetir é
melhor que perder: a conquista é o momento, e o custo de ver duas vezes é muito
menor que o de nunca ver.

Se o `POST` de ack falhar, o overlay fecha mesmo assim e a fila local é limpa.
A conquista reaparece no próximo fetch. É o mesmo trade-off.

### 4.6 Espera em fluxo de pagamento

O `PaymentSheet` da Stripe é um modal nativo. Um overlay de RN sobe atrás dele,
e o ack no fechamento gastaria a celebração sem o usuário ter visto nada.

O provider consulta `usePathname` e segura a fila enquanto a rota ativa for de
pagamento: `/cart`, `/caixa/pagar` e `/events/buy/*`. Ao sair dessas rotas, a
fila destrava e o overlay sobe.

### 4.7 Código desconhecido pelo catálogo

App novo contra API velha, ou código removido do catálogo: se o app não resolve
o `code`, ele não tem o que animar. Nesse caso ele faz ack do código mesmo
assim, sem animar.

Sem isso a fila trava: o `GET` devolve o mesmo código pendente para sempre, em
todo fetch, e nenhuma conquista posterior chega ao topo dos 10.

## 5. Casos de borda

**Mais de 10 pendentes.** O `GET` devolve 10, o app anima e faz ack desses 10,
e o próximo fetch traz o resto. Nada se perde, só serializa.

**Re-grant depois de um un-grant pelo admin.** O `dedupeKey`
`badge:${code}:${userId}` bloqueia a segunda linha de `Notification`, mas a
`GarageBadge` nova nasce com `celebratedAt` null. Resultado: a animação sobe de
novo, sem linha nova na central. Aceito. É um caminho de suporte, raro, e o
comportamento visível é benigno.

**Killswitch desligado.** `awardBadge` já retorna sem conceder nada, então não
há fila para formar. O `GET` devolve `enabled: false` e o provider não anima.

**Dois aparelhos.** O ack é do servidor, então o segundo aparelho não repete a
animação. Corrida entre os dois no mesmo instante é possível e inofensiva: o
`updateMany` filtra por `celebratedAt: null` e o segundo faz zero linhas.

## 6. Testes

API, integração contra Postgres real como manda o CLAUDE.md:

- `awardBadge` cria a linha de `Notification` nos quatro caminhos automáticos
  agora que o default virou `true`, inclusive quando o mesmo hook reavalia a
  superfície e reencontra uma conquista já ganha.
- `GET /me/garage/badges/celebrations` só devolve `celebratedAt: null`,
  respeita o teto de 10, ordena de forma determinística com `earnedAt` empatado,
  e devolve `enabled: false` com o killswitch desligado.
- `POST .../ack` carimba, é idempotente no segundo envio, e ignora código de
  outro usuário.
- A migration faz o backfill: linha criada antes da migration não aparece como
  pendente.
- `runNotificationDeliveryTick` agora entrega `badge_awarded`.

Shared: schemas novos, e `badge_awarded` aceito por `pushKindSchema`.

UI: `BadgeCelebration` renderiza o caso de uma e o de N conquistas.

Mobile:

- O provider busca nos quatro gatilhos.
- Depois do ack, não anima de novo.
- Com a rota ativa em `/caixa/pagar`, a fila espera; ao sair, anima.
- Código fora do catálogo recebe ack sem animar.
- Regressão: nenhum `setNotificationHandler` com `shouldShowAlert: true` no
  bundle do app.

## 7. Riscos

**O gatilho mais provável é o poll de 60s.** Quem negou push vê a animação com
até um minuto de atraso depois da ação que a gerou. Se isso incomodar, o
próximo passo é fazer as respostas dos endpoints que concedem conquista (criar
carro, postar) devolverem os códigos concedidos, e o app disparar na hora.
Ficou fora deste projeto por não valer o acoplamento agora.

**O default de `notifyOnGrant` vira `true` para todo chamador futuro.** Um
caminho de concessão em massa criado depois, como um recompute retroativo,
passaria a notificar todo mundo sem ninguém pedir. Quem escrever esse caminho
precisa passar `notifyOnGrant: false` de forma explícita. O comentário do campo
passa a dizer isso.
