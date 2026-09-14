# Celebração de conquista

Data: 2026-09-13
Status: revisado por quatro revisores adversariais, pronto para plano

## Problema

Ganhar uma conquista hoje é invisível. O usuário posta uma foto, faz check-in
ou cadastra um carro, a `GarageBadge` é criada na mesma transação, e nada
acontece na tela. Ele só descobre se abrir a garagem e reparar num hexágono
novo.

Três coisas bloqueiam o feedback:

1. `awardBadge` (`apps/api/src/services/garage/awarder.ts:59`) só emite a linha
   de `Notification` quando o chamador passa `notifyOnGrant: true`. Só o grant
   manual do admin passa (`apps/api/src/routes/admin/user-garage.ts:424`).
2. `badge_awarded` está explicitamente **fora** do worker de entrega de push
   (`apps/api/src/workers/notification-delivery.ts:15-23`).
3. Não existe estado que distinga "conquista que o usuário já viu celebrada"
   de "conquista nova". Sem isso, qualquer animação ou repete para sempre ou
   depende do aparelho.

## O que vamos entregar

Com o app aberto: a tela escurece, a conquista sobe com o texto, e a linha
aparece na central de notificações. Sem push.

Com o app fechado: push na bandeja, mais a linha na central. Tocar no push
abre o app e a mesma animação sobe.

## Os caminhos de concessão são três, não quatro

`awardBadge` é chamado de cinco lugares. Para efeito deste projeto:

- `apps/api/src/routes/cars.ts:90` — criar carro. Ativo.
- `apps/api/src/routes/feed.ts:368` — postar no feed. Ativo.
- `apps/api/src/services/tickets/check-in.ts:100` — check-in. Ativo, e é quem
  concede mais conquistas de uma vez.
- `apps/api/src/routes/auth/signup.ts:72` — **morto**. A única regra é
  `FOUNDER_CUTOFF = 2026-06-01` (`eligibility/signup.ts:13`), já passada, e o
  código que ela concederia é `premiumExclusive`, portanto barrado pelo gate
  de premium para conta nova. Não escrever teste contra este caminho.
- `apps/api/src/routes/admin/user-garage.ts:424` — grant manual do admin. Já
  passa `notifyOnGrant: true` hoje.

## Escopo

Dentro: campo de controle no banco e as duas migrations, notificação em todos
os caminhos de concessão, entrega de push agrupada e com gate de preferência,
duas rotas novas, o overlay animado, o gatilho que o dispara, e o mecanismo de
hold que impede o overlay de aparecer na hora errada.

Fora, e deliberadamente:

- Som, haptics e confete.
- Preferência de produto para desligar a animação. Reduce motion do sistema
  operacional **está dentro**, e é outra coisa.
- Celebração de XP ou de mudança de nível.
- Marcar visualmente como "nova" uma conquista dentro da `BadgesSheet`.
  `HexBadge` tem três variantes e nenhuma é "nova"
  (`packages/ui/src/HexBadge.tsx:7`). É o que tornaria um CTA útil, e é por
  isso que não há CTA.

## Decisões

| Questão                       | Decisão                                             |
| ----------------------------- | --------------------------------------------------- |
| Banner com o app aberto       | Sem push, decidido no servidor pelo ack. Ver §3.3.  |
| O que marca como já celebrada | `GarageBadge.celebratedAt` mais rota de ack.        |
| Conteúdo do overlay           | Badge, título, descrição. Só botão Fechar, sem CTA. |
| Várias conquistas de uma vez  | Uma tela só, e **um push só**.                      |
| Preferência de push           | `badge_awarded` honra `pushPrefs.transactional`.    |

## 1. Modelo e migrations

`GarageBadge` (`packages/db/prisma/schema.prisma:347-364`) ganha:

```prisma
celebratedAt DateTime?
```

mais `@@index([garageId, celebratedAt])`. `celebratedAt = null` é a fila.
Não há tabela nova.

### Dois arquivos de migration, não um

O Prisma roda cada arquivo numa transação. `ALTER TABLE ... ADD COLUMN` pega
`ACCESS EXCLUSIVE` e segura até o commit, então um `UPDATE` de tabela inteira
no mesmo arquivo faz a reescrita toda dentro do lock. Durante ele, check-in e
`POST /me/cars` bloqueiam na fila de lock. `cars.ts` roda `Serializable` com
`timeout: 15000` e três tentativas (`cars.ts:54,115`): um backfill mais longo
que isso vira 500 na cara do usuário, no meio de um evento.

**Arquivo 1** — DDL apenas. `ADD COLUMN` de coluna anulável sem default é
metadata-only no Postgres 11+, então o lock é instantâneo. `CREATE INDEX` por
último, como faz o precedente
(`migrations/20260816000000_notification_delivery_state/migration.sql:13`).

**Arquivo 2** — os dois backfills, fora do lock de DDL:

```sql
UPDATE "GarageBadge" SET "celebratedAt" = "earnedAt" WHERE "celebratedAt" IS NULL;
UPDATE "Notification" SET "sentAt" = "createdAt" WHERE "kind" = 'badge_awarded' AND "sentAt" IS NULL;
```

O `WHERE IS NULL` não é cosmético: torna o statement re-executável se a
migration falhar no meio.

### O segundo backfill é tão obrigatório quanto o primeiro

Toda linha `badge_awarded` já escrita em produção tem `sentAt = null` de
propósito — `awarder.ts:180-189` nunca carimba, e
`apps/api/test/admin/badge-notification.test.ts:99-100` afirma isso como
contrato. A query do worker não tem piso de `createdAt`
(`notification-delivery.ts:34-44`). No primeiro tick depois de `badge_awarded`
entrar em `DELIVERABLE_KINDS`, **toda linha histórica do grant manual do admin
vira push**, de conquistas ganhas há meses. O usuário toca, o app abre, e a
fila de celebração está vazia porque o primeiro backfill acabou de fechá-la.

O repo já resolveu exatamente isso em agosto, com o comentário explicando o
porquê (`20260816000000_notification_delivery_state/migration.sql:9-11`).

Antes do deploy, rodar `SELECT count(*) FROM "Notification" WHERE kind =
'badge_awarded' AND "sentAt" IS NULL;` e registrar o número. Ninguém sabe qual
é hoje.

### Risco de statement timeout

Se um dos `UPDATE` estourar o `statement_timeout` do Railway, o Prisma marca a
migration como falha e **toda release seguinte falha** até alguém rodar
`migrate resolve --rolled-back` contra produção. O repo já documenta essa
armadilha em
`migrations/20260911190433_gamification_copy/migration.sql`. Conferir a
contagem das duas tabelas antes; se `Notification` estiver grande, quebrar o
segundo `UPDATE` em lotes por `createdAt`.

## 2. API

### 2.1 Notificar em todos os caminhos

`AwardBadgeOptions.notifyOnGrant` passa a default `true`. Nenhum arquivo
chamador precisa mudar: os três hooks ativos omitem o objeto de opções por
completo, e o admin já passa `true` explícito.

O bloco de notificação (`awarder.ts:172-200`) já tem savepoint próprio
(`SAVEPOINT awardbadge_notify`) e já engole a colisão de `dedupeKey`. A
mecânica não muda.

**Reavaliação não notifica duas vezes, e isso é estrutural.** Cada hook
reavalia a superfície inteira a cada escrita (`awarder.ts:130-133`), então o
segundo carro reencontra CAR-001. Nesse caminho o `tx.garageBadge.create`
(`awarder.ts:137`) estoura P2002 e o controle pula direto para o catch de fora
(`awarder.ts:204`); o bloco de notificação é inalcançável. Quem for mexer aqui
não pode hoistar a notificação para fora do `try` — seria exatamente isso que
criaria a tempestade.

A linha ganha `destination: { kind: 'internal_path', path: '/garage' }`, que a
central resolve via `openDestination`
(`apps/mobile/app/(app)/notifications/index.tsx:65`). O toque no **push** não
usa `destination`: `use-push-open-handler.ts:6-10` roteia só por
`data.route === 'notifications'` e sempre aterrissa na central. Isso é
aceitável, porque o overlay sobe por cima de onde quer que o app abra.

Comentar no campo que um caminho futuro de concessão em massa precisa passar
`notifyOnGrant: false` explícito.

### 2.2 Rotas novas

No padrão de escopo com rate limit de `/me/garage/badges`
(`apps/api/src/routes/garage.ts:357-380`).

**`GET /me/garage/badges/celebrations`** — 60/min/usuário.

```json
{ "enabled": true, "pending": [{ "code": "EVT-001", "earnedAt": "..." }] }
```

- `celebratedAt: null`, `earnedAt >= now() - 7 dias`, ordem `earnedAt` asc e
  `badgeCode` asc, teto de 10.
- A ordenação total é de propósito: `@default(now())` é o início da transação
  no Postgres, então conquistas da mesma transação empatam em `earnedAt`
  exatamente, e sem o desempate a ordem varia entre chamadas.
- Antes de responder, a rota carimba como celebradas as linhas **mais velhas
  que 7 dias** que ainda estão `null`. Autolimpeza, sem worker.
- Killswitch desligado devolve `{ enabled: false, pending: [] }`.

A janela de 7 dias existe por causa de skew de versão de app. A API entra
antes do app. Um build antigo nunca chama o ack, então tudo que ele ganhar
fica `null`. Sem a janela, esse usuário atualiza semanas depois e recebe a
fila histórica inteira — o mesmo problema que o backfill resolveu, reaberto
pela porta dos fundos.

**`POST /me/garage/badges/celebrations/ack`** — 20/min/usuário.

Body `{ "codes": [...] }`, no máximo 10, cada um validado por
`badgeCodeSchema`. Faz duas coisas, na mesma transação:

1. `updateMany` de `GarageBadge` com `celebratedAt: now()` onde `garageId` é do
   usuário, `badgeCode` está na lista e `celebratedAt` é null.
2. `updateMany` de `Notification` com `sentAt: now()` onde `userId` é do
   usuário, `kind = 'badge_awarded'`, `sentAt` é null e o `dedupeKey` está no
   conjunto derivado dos códigos via `badgeAwardedDedupeKey`.

Responde `{ "acked": n }`. Idempotente: um segundo ack devolve `0`.

O passo 2 é o que entrega o requisito do usuário. Ver §3.3.

### 2.3 Schemas compartilhados

`packages/shared/src/badges.ts` ganha `badgeCelebrationsResponseSchema`,
`badgeCelebrationsAckRequestSchema` e `...AckResponseSchema`.

### 2.4 Testes existentes que afirmam o contrário

Três testes codificam hoje o comportamento que este projeto inverte. Atualizar
os três de propósito, não por acidente ao ver falhar:

- `apps/api/test/admin/badge-notification.test.ts:131` — `auto-award
(write-path hook) does NOT mint a notification`.
- `apps/api/test/admin/badge-notification.test.ts:256` — `awarder service:
default opts (no notifyOnGrant) does not mint inbox row`.
- `apps/api/test/workers/notification-delivery.test.ts:70` — `never delivers
non-owned kinds (broadcast, badge_awarded)`.

Mais os comentários de contrato em `badge-notification.test.ts:14-17`,
`awarder.ts:45-58` e `notification-delivery.ts:8-14`.

## 3. Push

`badge_awarded` entra em `pushKindSchema` (`packages/shared/src/push.ts:23-31`)
e em `DELIVERABLE_KINDS` (`notification-delivery.ts:15-23`). O worker ganha
três coisas que não tinha.

### 3.1 Um push por usuário por tick, não um por conquista

O awarder é por código e os hooks iteram uma lista, então um check-in que
destrava três conquistas cria três linhas com `dedupeKey` diferentes
(`badgeAwardedDedupeKey`, `packages/shared/src/badges-copy.ts:13`), e o índice
único não as funde. Entregar linha a linha significa três vibrações no portão
do evento, com o mesmo título fixo `'Nova conquista!'` nas três.

A decisão "uma tela só, com todas" vale para o push também. Dentro do tick, as
pendentes de `badge_awarded` são agrupadas por `userId`:

- Uma conquista: título e corpo de hoje.
- N conquistas: um push, "Você ganhou N conquistas".

As N linhas recebem `sentAt` juntas. A central continua com N linhas, uma por
conquista, que é o certo: cada conquista merece seu registro histórico.

O agrupamento fica no worker, não no awarder. O awarder está dentro da
transação do usuário e não pode saber quantos códigos ainda vão cair.

### 3.2 Killswitch e preferência

`deliverNotification` não consulta nada hoje
(`apps/api/src/services/push/transactional.ts:63-174`). Duas guardas no tick,
antes de entregar `badge_awarded`:

- `readGamificationEnabled()` uma vez por tick. Sem ela, o admin desliga a
  gamificação e ainda vê push sair pelos próximos minutos, com o `GET`
  devolvendo `enabled: false` e o app obrigado a não mostrar nada.
- `pushPrefs.transactional` do usuário. Leitura em lote dos candidatos,
  filtro em JS, ausência da chave conta como `true`. A coluna é Json
  (`schema.prisma:69`) e a chave pode faltar em linha antiga.

A linha da central é criada de qualquer jeito. A preferência governa o push,
não o inbox.

Só `badge_awarded` passa por essas guardas. `ticket.confirmed`, `box.*` e os
lembretes de evento não mudam.

### 3.3 Por que não existe push para quem está com o app aberto

O worker é cron de um minuto (`notification-delivery.ts:75`). A linha nasce em
t=0 e só seria enviada em t≤60s. Nesse intervalo, um app em foreground já
buscou, celebrou e fez ack, e o passo 2 do ack (§2.2) carimbou `sentAt`. O
worker chega e não tem o que enviar.

Isso entrega o requisito no servidor, sem rastrear presença e sem depender de
o cliente esconder banner.

Não é garantia absoluta: se o usuário deixar o overlay aberto por mais de um
minuto sem fechar, o push sai. A rede de segurança é a mesma de antes, e ela
continua valendo.

### 3.4 A supressão em foreground continua sendo a rede de segurança

Não existe `setNotificationHandler` em nenhum lugar de `apps/` ou `packages/`,
e o default da versão instalada (`expo-notifications@0.32.17`) é não apresentar
a notificação com o app em foreground. Documentado na fonte do próprio pacote,
em `NotificationsHandler.ts`.

**O teste de regressão precisa afirmar que não existe handler nenhum.** Numa
versão anterior desta spec ele afirmava "nenhum handler com
`shouldShowAlert: true`", que está errado: nessa versão `shouldShowAlert` é
deprecado em favor de `shouldShowBanner` e `shouldShowList`, e o exemplo da
própria documentação usa `shouldShowBanner: true`. Quem adicionasse um handler
copiando a doc passaria pelo teste e quebraria o requisito em silêncio.

`expo-notifications` vira dependência load-bearing. Bump de versão pede
reconferir esse default.

### 3.5 Entrega no signup

`deliverNotification` carimba `sentAt` e devolve `delivered: true` quando o
usuário tem zero `DeviceToken` (`transactional.ts:111-118`). Conta nova ainda
não passou pelo prompt de permissão, então uma conquista concedida no cadastro
teria o push morto para sempre. Hoje isso é teórico, porque o caminho de
signup está morto. Fica registrado para quem reativar a regra de fundador.

## 4. Mobile

### 4.1 Onde vive

`BadgeCelebrationProvider` em `apps/mobile/app/(app)/_layout.tsx`, envolvendo
`AppTabs` por dentro do `CartProvider`.

O overlay **precisa renderizar dentro de um `Modal`** da React Native, não como
`View` irmã das tabs. `SheetShell` (`packages/ui/src/SheetShell.tsx:42`) usa
`Modal`, e toda folha do app passa por ele: `BadgesSheet`, `BuySpotSheet`,
`EditGarageSheet`, `CoverPickerSheet`, `MarketingConsentModal`. `Modal` é
janela nativa separada, fora da hierarquia da raiz React. Uma `View` irmã das
tabs sobe acima do navegador e de qualquer tela empilhada, e **fica atrás de
todas essas folhas**.

Isso não basta sozinho: dois `Modal` simultâneos são frágeis no iOS. Por isso
o hold da §4.6.

O componente visual puro `BadgeCelebration` vai para `packages/ui`, recebendo
copy e dados já resolvidos por props, no mesmo contrato do `BadgeDetail`
(`packages/ui/src/BadgeDetail.tsx:22-23`). Fetch, fila e ack ficam no mobile.

### 4.2 Gatilhos

1. **Depois de uma escrita que concede.** Ao sucesso de criar carro e de
   postar no feed, o app chama `refresh()` na hora. É o que torna a celebração
   uma celebração.
2. Montagem do provider. Cobre cold start e o toque no push.
3. `AppState` voltando para `active`.
4. `Notifications.addNotificationReceivedListener`, com guarda
   `Platform.OS === 'web'` como em `use-push-open-handler.ts:22`.
5. Timer de 5 minutos.

O gatilho 1 é o principal e é o que faltava. Sem ele, nenhum gatilho dispara
antes do cron de um minuto: o push não pode chegar antes do worker, e o timer
é independente da ação. A média ficaria em ~30s entre a ação e a animação, o
que quebra o vínculo entre o que o usuário fez e o prêmio — e valeria para
todo mundo, não só para quem negou push.

Check-in fica sem o gatilho 1 de propósito: quem dispara é o scanner do admin,
o app do usuário não sabe de nada. Esse caso depende dos gatilhos 3, 4 e 5.

Cinco minutos, não sessenta segundos: com o gatilho 1 no lugar, o timer só
cobre check-in e grant de admin. Um timer global de 60s seriam 1440 requisições
por usuário por dia para um evento que acontece meia dúzia de vezes na vida da
conta.

**O provider só roda autenticado.** `(app)/_layout.tsx` monta para anônimo em
`/inicio`, `/events`, `/store` (`apps/mobile/src/auth/redirect-intent.ts:6-15`).
Sem esse gate, cada tick estoura `ApiError(401)` em `client.ts:92`; e com
refresh token expirado o caminho de falha chama `onSignOut`
(`client.ts:112-118`), o que transformaria um poll global num jeito novo de
deslogar o usuário no meio de um pagamento. O `useUnreadCount` escapa disso
por estar dentro de `useFocusEffect`; este provider não está.

**Guarda de in-flight, obrigatória.** Um ref que bloqueia GET concorrente, mais
um conjunto em memória dos códigos já acked localmente, aplicado como filtro em
toda resposta. Sem isso: dois pushes seguidos disparam dois GETs, o segundo
resolve depois do ack, e o overlay ressuscita com a conquista que o usuário
acabou de fechar.

**O timer pausa enquanto o overlay está visível.** Sem isso, com o ack só no
fechamento, cada tick devolve a mesma lista e reinicia a animação por baixo do
usuário.

### 4.3 Conteúdo

Uma conquista: hexágono `lg`, "NOVA CONQUISTA!", título, descrição.

N conquistas: até 6 hexágonos `md` com quebra de linha, "VOCÊ GANHOU N
CONQUISTAS", os títulos em lista, e "+N" quando passa de 6. Sete hexágonos de
52pt com espaçamento não cabem em 375pt de largura, e o teto da fila é 10.

Só botão "Fechar". Fecha também no toque fora e no botão voltar do Android,
via `BackHandler` registrado só enquanto visível, no padrão de
`FeedComposerSheet.tsx:97`.

Sem CTA: mandar para a garagem sem marcar quais são as novas deixa o usuário
caçando hexágono num grid de 13, e marcar exigiria uma variante nova no
`HexBadge` mais prop nova na `BadgesSheet` mais param de rota. Está fora do
escopo, e sem isso o CTA atrapalha mais do que ajuda.

### 4.4 Copy

Quatro chaves em `apps/mobile/src/copy/badges.ts`, com o espelho `en`
obrigatório, no padrão do que já existe lá: `celebrationTitleOne`,
`celebrationTitleMany`, `celebrationClose`, `celebrationMore`.

Título e descrição de cada conquista continuam vindo do catálogo do banco,
que é o editável em `/configuracoes/conquistas`.

Nada de string inline em `packages/ui`. É o que já aconteceu com o
`CATEGORY_LABEL` da `BadgesSheet` e não deve se repetir.

### 4.5 De onde vem o catálogo, e quando fazer ack de código desconhecido

O app **não tem cliente de `/badges/catalog`**. O que ele já usa é
`GET /me/garage/badges`, que devolve o mesmo catálogo junto com o estado do
dono (`apps/api/src/services/garage/badges-read.ts:26`). Usar esse, sem
endpoint novo no cliente.

Resolução de cada código, em ordem: catálogo da API, depois o fallback do
bundle (`copy/badges.ts`, que é documentado exatamente para isso e já é usado
assim em `apps/mobile/app/(app)/garage/index.tsx:164-167`, com lookup por
código e não por entrada do catálogo).

**Só fazer ack de código não resolvido quando o catálogo carregou com
`enabled: true` e o código genuinamente não está nele.** Nunca em falha de
fetch, nunca com catálogo vazio.

A versão anterior desta spec dizia "se não resolve, faz ack e não anima",
justificado por "código removido do catálogo". Esse estado é impossível: a FK é
`onDelete: Restrict` (`schema.prisma:359`) e a migration de prune se recusa a
apagar `Badge` com dono
(`20260913120200_prune_unearnable_badges/migration.sql`). O único jeito real de
o app não resolver um código é o fetch do catálogo falhar, ou o killswitch
virar entre as duas chamadas. A regra como estava queimava a fila inteira,
permanentemente, por causa de uma requisição ruim.

### 4.6 Hold: quando o overlay não pode subir

Nada de lista de rotas. A versão anterior desta spec listava `/cart`,
`/caixa/pagar` e `/events/buy/*`: a terceira é um stub que só redireciona e não
apresenta PaymentSheet nenhum, e faltavam as duas que apresentam,
`/profile/orders` e `/assinaturas/contratar`. `usePathname` também é o sinal
errado por natureza, porque o PaymentSheet é imperativo e a rota não muda
enquanto ele está aberto.

Em vez disso, um módulo mínimo com `acquireCelebrationHold()` /
`release()` e um hook `useCelebrationHold()`. Enquanto a contagem for maior
que zero, a fila espera. Quatro pontos chamam, e cada um é chokepoint único:

- `packages/ui/src/SheetShell.tsx` — pega todas as folhas de uma vez, incluindo
  a `BadgesSheet`, e resolve o problema de camada da §4.1.
- `apps/mobile/src/payments/payment-sheet.ts` — pega os quatro chamadores de
  `usePaymentSheet` de uma vez, e não sai de sincronia quando alguém adicionar
  o quinto.
- `apps/mobile/src/screens/events/feed/FeedComposerSheet.tsx` — não é `Modal`,
  é `Animated.View` inline, então o overlay **conseguiria** cobri-lo, derrubar
  o teclado e pôr o rascunho em risco. É também onde o usuário está quando
  ganha a conquista de post.
- `apps/mobile/app/(app)/tickets/[ticketId].tsx` — a tela do QR. É o pior
  momento possível: o usuário está com o telefone estendido no portão, brilho
  no máximo, e o check-in que acabou de acontecer é justamente o caminho que
  concede mais conquistas de uma vez. Escurecer a tela e cobrir o QR com um
  modal sem auto-dismiss, com fila atrás e um ingresso de convidado ainda por
  escanear, é o pior resultado que este projeto pode produzir.

### 4.7 Ack e falha de ack

Ack no **fechamento**, não na abertura. Se o app morrer no meio da animação,
ela volta. Repetir é melhor que perder.

Se o `POST` falhar, o código entra no conjunto local de acked do mesmo jeito e
o retry vai no próximo tick. Sem isso: o ack é 20/min, o `GET` é 60/min, e numa
conexão ruim o overlay volta a cada tick, tela cheia, sem auto-dismiss, e o
usuário não tem como desligar. Não é um repeat benigno, é um loop.

### 4.8 Animação e acessibilidade

`Animated` da React Native. O precedente correto é
`FeedComposerSheet.tsx:64-84`, que usa `spring` e `timing` em `translateY` e
`opacity` com `useNativeDriver: true`. **Não** citar `BudgetMeter.tsx`: ele usa
`useNativeDriver: false` e tem comentário dizendo que precisa.

Acessibilidade, tudo novo, sem precedente no repo:

- `accessibilityViewIsModal`, como `SheetShell.tsx:55`. Sem isso o VoiceOver
  passa direto para a tela escurecida atrás.
- Label real. `HexBadge.tsx:85` monta `Conquista ${code}, desbloqueada`, então
  hoje o leitor de tela anuncia "Conquista EVT-001, desbloqueada". O overlay
  passa o título de verdade.
- `AccessibilityInfo.isReduceMotionEnabled()`: com reduce motion ligado, o
  conteúdo aparece sem spring nem stagger. É ajuste do sistema operacional, não
  preferência de produto, e portanto não está coberto pelo item de escopo que
  exclui "preferência para desligar a animação".
- `announceForAccessibility` na abertura.
- Botão "Fechar" visível e rotulado. Toque fora é invisível e não alcançável
  por leitor de tela; não pode ser a única saída.

Insets de safe area via `useSafeAreaInsets`, senão o botão cai embaixo do home
indicator.

## 5. Casos de borda

**Mais de 10 pendentes.** O `GET` devolve 10, o app anima e faz ack desses 10,
o próximo fetch traz o resto.

**Dois aparelhos.** O ack é do servidor. O segundo não repete: o `updateMany`
filtra `celebratedAt: null` e faz zero linhas.

**Killswitch desligado.** Não forma fila nova, o `GET` devolve
`enabled: false`, e §3.2 impede que o que já estava na fila vire push.

**Retenção de 90 dias.** O `dedupeKey` que impede segunda notificação vive numa
tabela com purga (`apps/api/src/workers/retention.ts:91-97`). Quando
`RETENTION_WORKER_ENABLED` for ligado, a proteção some para conquista de mais
de 90 dias. Só importa se um dia existir caminho de re-concessão; hoje não
existe endpoint de revogar conquista.

**Skew de versão de app.** Coberto pela janela de 7 dias da §2.2.

## 6. Testes

API, integração contra Postgres real:

- `awardBadge` cria a linha de `Notification` nos três caminhos ativos.
- Reavaliar a superfície e reencontrar conquista já ganha **não** cria segunda
  notificação.
- `GET` só devolve `celebratedAt: null` dentro da janela de 7 dias, carimba as
  mais velhas, respeita o teto de 10, ordena de forma determinística com
  `earnedAt` empatado, e devolve `enabled: false` com killswitch desligado.
- `POST .../ack` carimba `celebratedAt`, carimba `sentAt` das linhas ainda não
  enviadas, é idempotente, e ignora código de outro usuário.
- Ack antes do tick faz o worker não enviar push nenhum.
- As duas migrations: linha de `GarageBadge` anterior não aparece como
  pendente, e linha de `Notification` anterior não vira push.
- Worker: agrupa N conquistas do mesmo usuário num push só; respeita
  `pushPrefs.transactional: false`; não entrega com killswitch desligado.

Shared: schemas novos, `badge_awarded` aceito por `pushKindSchema`.

UI: `BadgeCelebration` com uma, com seis e com dez conquistas.

Mobile:

- Fetch depois de criar carro e de postar.
- Depois do ack, não anima de novo, inclusive quando um GET em voo resolve
  depois.
- Com hold ativo, a fila espera; ao liberar, anima.
- Código não resolvido com catálogo carregado recebe ack; com fetch do catálogo
  falhando, **não** recebe.
- Falha de ack não gera loop.
- Não busca nada sem usuário autenticado.
- Regressão: nenhum `setNotificationHandler` em `apps/` ou `packages/`.

## 7. LGPD

Push de conquista não é transacional. `docs/ropa.md:20-21` tem exatamente duas
entradas de push: `MSG-01` transacional sob Art. 7, V, contrato, e `MKT-01`
marketing sob Art. 7, I, consentimento. Celebração de gamificação não é
nenhuma das duas, e a tela do app enumera para o usuário o que é transacional:
"confirmação de ingresso e lembretes de evento"
(`apps/mobile/src/copy/profile.ts:88-89`).

Duas entregas, decididas:

1. `badge_awarded` honra `pushPrefs.transactional` (§3.2). O campo já existe,
   já é devolvido por `GET /me/push-preferences`, já é zerado na
   anonimização, e hoje nenhum caminho de envio o lê. Passa a ser lido por
   este kind e só por ele.
2. Entrada nova na ROPA descrevendo a atividade, os dados no payload, a base
   legal e o opt-out.

O payload em si está no nível certo: título fixo, corpo com o título da
conquista, `data` com `kind` e `code`. Nenhum nome, e-mail, placa ou valor.
Vale saber que o corpo é editável pelo admin em `/configuracoes/conquistas`, e
portanto o que aparece na tela de bloqueio é o que alguém digitou lá.

## 8. Riscos que ficam

**O agrupamento de push é por tick, não por transação.** Duas conquistas
concedidas em ticks diferentes viram dois pushes. Aceito: o caso que importa,
o check-in que destrava várias de uma vez, cai num tick só.

**O hold depende de disciplina.** Uma superfície nova que apresente modal
nativo e esqueça de chamar `acquireCelebrationHold` reabre o problema. Mitigado
por os quatro pontos atuais serem chokepoints, não chamadas espalhadas.

**`expo-notifications` é load-bearing.** O requisito de não mostrar banner em
foreground depende do default da biblioteca. Bump de versão pede reconferir.
