# Casa In Box — funil de pré-venda

Data: 2026-11-09
Status: aguardando aprovação (revisão adversarial aplicada)

## Intenção

O produto físico está pronto e a CASA quer começar a vender agora. Hoje a loja
só vende para quem já tem conta e já está dentro do app. A pré-venda da Casa In
Box precisa vender para quem chega de fora: um link que a pessoa abre, entende o
produto, monta a caixa e paga, sem criar conta.

O cliente paga o **valor integral** do pedido. A caixa é um agrupamento dos itens
escolhidos, não um pacote de preço fechado.

## Não é

- **Não é a Caixa mensal.** Já existe uma feature chamada "Caixa" no app
  (`MonthlyBox`): a caixa do premium, com orçamento mensal e cobrança só do
  excedente, gated por assinatura. São produtos diferentes. Nada neste trabalho
  toca `MonthlyBox`, `BoxSettings` ou `apps/mobile/app/(app)/caixa/*`.
- **Não é uma reforma da loja.** O fluxo autenticado de `Cart` → `/cart/checkout`
  continua exatamente como está.
- **Não é assinatura.** Pagamento único, BRL, Stripe.
- **Não é catálogo novo.** Os produtos, preços, fotos e variantes são os mesmos
  do catálogo da loja. A pré-venda só filtra quais aparecem.

## Anti-goals

Coisas que, se acontecerem, tornam isso um fracasso mesmo funcionando:

- Um pedido pago sem pedido registrado, ou dois pedidos para um pagamento.
- O total mostrado antes do redirecionamento divergir do cobrado na Stripe.
- A loja convencional quebrar ou mudar de comportamento.
- A caixa montada sumir quando a pessoa volta da Stripe sem pagar.
- A pessoa de fora da área de entrega conseguir pagar frete e esperar entrega.
- Qualquer efeito de um formulário público sobre a conta de um membro.

## Decisões do dono do produto

1. **Onde mora:** rotas novas dentro de `apps/garage` (Next.js, `garage.casacar.club`).
   Sem projeto Vercel novo, sem subdomínio novo.
2. **Sem conta:** compra como convidado, dados informados na própria página.
3. **Frete e área:** configuração própria da campanha, separada do Box mensal e
   da loja.
4. **Preço:** a pré-venda cobra o **preço base puro**, sem o `DEV_FEE_PERCENT`
   que a loja soma (10% por padrão). O mesmo SKU fica mais barato na pré-venda
   do que no app. Divergência deliberada, ver "Preço e taxa".
5. **Email:** o convidado recebe email de confirmação depois que o webhook
   confirma o pagamento.
6. **Identidade do convidado:** usuário-sistema único + tabela própria de
   convidado. **Nenhuma linha de `User` é criada ou tocada por email vindo do
   formulário público.** Decidido depois da revisão, ver "Por que não upsert por
   email".
7. **Estoque:** a pré-venda **não reserva**. O saldo da variante só é debitado
   quando o pagamento confirma. Decidido depois da revisão, ver "Estoque".

As decisões 6 e 7 substituem decisões anteriores (upsert de `User` por email, e
reserva de estoque igual ao carrinho). As duas foram derrubadas por defeitos
confirmados no código, documentados abaixo.

## Por que não upsert por email

A primeira versão deste desenho criava um `User` com `status: 'partial'` por
email, alegando ser "exatamente o que `admin/users.ts` já faz". Isso era falso e
abria três vetores, todos confirmados lendo o código:

- **Bloqueio de cadastro.** `routes/auth/signup.ts:28-31` devolve 409 para
  qualquer email que já exista, sem exceção para `partial`. Um formulário
  público que cria linhas por email deixa qualquer um impedir o cadastro de
  qualquer email, em lote.
- **Conta semeada por terceiro.** `packages/shared/src/auth.ts:24` não inclui
  `partial` em `INACTIVE_USER_STATUSES`, então `forgot-password` emite token
  para a linha plantada, e `routes/auth/reset-password.ts:21-28` promove
  `partial` a `active` + `emailVerifiedAt`. A vítima recupera uma conta que
  carrega o nome, o endereço, os pedidos e o aceite de termos de outra pessoa.
- **Redirecionamento de entrega e consentimento forjado.**
  `routes/cart.ts:623-631` escolhe **qualquer** endereço do usuário quando o
  checkout não manda `shippingAddressId`, e o comentário no próprio arquivo
  admite que esse fallback "decide where physical goods are shipped". Um
  endereço plantado redireciona a próxima entrega da vítima. Em paralelo,
  `services/consent.ts:33-36` devolve o consentimento existente em vez de criar
  outro: um `privacy_notice` forjado com IP de terceiro fica permanente, e a
  aceitação real da vítima nunca é gravada.

Diferenças que invalidam a analogia com `routes/admin/users.ts:244-288`: aquele
endpoint é `create` e não upsert, é `requireRole('admin')`, trata colisão como
409, grava `AdminAudit`, e usa `name: email` em vez de texto livre do chamador.

## Estoque

A pré-venda **não cria reserva**. `Variant.quantitySold` é incrementado só na
liquidação do pagamento.

O motivo é que reserva mais compra anônima não combinam. O carrinho reserva em
`services/cart/checkout.ts:437-448` no momento em que o pedido nasce `pending`, e
isso é seguro lá porque o checkout exige autenticação. Num POST público, cada
chamada seguraria estoque real por 30 minutos de graça. O rate limit não
resolveria: `trustProxy` não está setado em `app.ts:99-103`, e
`routes/premium-catalog.ts:78-82` documenta a consequência no próprio repo — atrás
do Railway, `req.ip` é o proxy para todo mundo e a chave colapsa num único balde
global. Limitar por IP ali seria amplificador de DoS, não defesa.

Consequências, aceitas:

- **Pode vender um pouco além do saldo** se dois pagamentos confirmarem juntos.
  A pré-venda é produção para o primeiro lote, então isso vira fila, não
  cancelamento. O incremento na liquidação **não** é guardado por
  `quantitySold + qty <= quantityTotal`; passar do total é permitido e logado.
- **Vitrine e montagem usam saldo como indicativo**, não como garantia. Item com
  `quantitySold >= quantityTotal` sai da vitrine, mas nada impede que esgote
  entre a montagem e o pagamento.
- Em troca, somem três defeitos de uma vez: o vazamento de estoque nas rotas de
  falha do webhook, o acúmulo de pedidos pendentes segurando peça por comprador,
  e o esgotamento anônimo da campanha e da loja junto.

## O que já existe e vai ser reaproveitado

Esta tabela foi corrigida depois da revisão. As linhas marcadas com ⚠ eram
afirmações falsas na primeira versão.

| Peça                          | Onde                                                         | Como entra                                                   |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Catálogo + variantes + fotos  | `Product`, `Variant`, `ProductPhoto`                         | fonte única de preço e imagem                                |
| Pedido e composição           | `Order` + `OrderItem`                                        | pedido de pré-venda é `kind: 'product'`                      |
| Liquidação do pagamento       | `services/orders/settle.ts`, ramo `kind === 'product'`       | o pedido cai nesse ramo; ganha um braço para debitar estoque |
| Sessão de checkout            | `services/stripe/index.ts` `createCheckoutSession`           | pagamento único, BRL, com `idempotencyKey`                   |
| Dedupe de evento              | `PaymentWebhookEvent`, `@@unique([provider, eventId])`       | evita reprocessar o mesmo `event.id`                         |
| HMAC com separação de domínio | `apps/api/src/lib/qr.ts`                                     | token da página de confirmação, com kind novo                |
| Consentimento público         | `ConsentChannel.web_public`, `ConsentPurpose.privacy_notice` | registro LGPD do convidado                                   |
| Mailer                        | `services/mailer` (Resend em prod, `DevMailer` local)        | email de confirmação                                         |
| Rollback compensatório        | `services/cart/checkout.ts:637` `rollbackCartCheckout`       | padrão a imitar, não a chamar                                |
| ⚠ Serializadores públicos     | `routes/store.ts`                                            | **não reaproveitáveis**, ver "Serialização"                  |
| ⚠ Flag de vitrine             | `Product.visibleInStore`                                     | **não é o padrão a copiar**, ver "Admin"                     |
| ⚠ Reserva e liberação         | `services/orders/expire.ts`                                  | **não usado**, a pré-venda não reserva                       |
| ⚠ Webhook                     | `routes/stripe-webhook.ts`                                   | **precisa de mudança**, ver "Webhook"                        |

## Arquitetura

### Nomenclatura

Namespace `presale` no código, "Casa In Box" na copy. Nunca `caixa` ou `box` no
código novo, para não colidir com `MonthlyBox`.

### Rotas públicas (apps/garage)

- `/casa-in-box` — landing de pré-venda
- `/casa-in-box/montar` — montagem ("Minha caixa")
- `/casa-in-box/obrigado` — retorno da Stripe

**Mudança no layout do garage, especificada por inteiro.** Hoje
`apps/garage/app/layout.tsx:41` embrulha tudo numa coluna `max-w-[430px]`, porque
a página de garagem é uma tela de celular portada. Uma landing não cabe nisso. O
desenho anterior dizia que um layout de route group `(garage)` cobriria também o
`not-found`, e isso é **falso**: `app/not-found.tsx` é o 404 global de URLs não
casadas e renderiza dentro do root layout, não dentro de layouts de route group.
O que realmente acontece:

1. A coluna sai de `app/layout.tsx`.
2. `app/g/` vira `app/(garage)/g/`, com `app/(garage)/layout.tsx` carregando a
   coluna.
3. `app/not-found.tsx` **fica onde está** e passa a embrulhar o próprio conteúdo
   na mesma coluna. Sem isso, o 404 de `garage.casacar.club/qualquer-coisa`
   perde a coluna e o `NotFoundShell` (`max-w-xs` centralizado) estica no
   desktop.
4. Dois imports de teste quebram e precisam acompanhar o movimento:
   `src/components/__tests__/public-garage-view.test.tsx:7` e
   `app/g/[slug]/__tests__/page.test.tsx`.

São cinco arquivos existentes do garage tocados, não um. O comportamento visual
da garagem e do 404 fica idêntico.

### API (apps/api)

Prefixo `/presale/casa-in-box`, todas públicas, sem `app.authenticate`. Gate
próprio: 503 quando `PresaleSettings.enabled` é falso. **Não** reaproveita o
`preHandler` de `storeRoutes` (`routes/store.ts:321-328`), que desligaria a
pré-venda junto com a loja.

- `GET /campaign` — config pública: ativo, frete, área atendida, endereço e
  horário da retirada, previsão do primeiro lote.
- `GET /products` — produtos elegíveis. Mesma regra de elegibilidade nas três
  superfícies (vitrine, montagem, checkout), aplicada por **uma** função.
- `POST /checkout` — dados do convidado, itens e opção de recebimento.
  Recalcula tudo no servidor, cria pedido e sessão Stripe, devolve a URL.
- `POST /orders/status` — estado real do pedido para a página de retorno.

Sobre `@fastify/rate-limit`: entra como backstop de banco contra cliente em laço,
no mesmo espírito do comentário em `routes/premium-catalog.ts:80-86`, e **não**
como proteção contra abuso. Com `trustProxy` desligado o balde é global, então o
teto tem que folgar bem acima do tráfego de um lançamento, senão o limitador
derruba comprador legítimo. Ligar `trustProxy` é tarefa própria, fora desta.

**Token do pedido.** O estado do pedido é consultado por `POST`, com
`{ orderId, token }` no corpo — não por querystring. `apps/api/src/logger.ts:5-12`
só remove `webhookSecret` de query params e `disableRequestLogging` é `false`, então
um `?t=` viraria credencial portadora em texto claro em toda linha de log de
acesso, retida 90 dias (`packages/shared/src/legal.ts:195`), e a página de retorno
faz polling.

O token é assinado por `apps/api/src/lib/qr.ts`, com um **kind novo** adicionado
ao conjunto, e não por `services/tickets/codes.ts`. O `qr.ts` mistura o kind na
entrada do HMAC exatamente para rejeitar código de um domínio em outro; o
`codes.ts` assina o id puro, e os dois usam `TICKET_CODE_SECRET`. Hoje nada
explode porque um lado busca `Ticket` e o outro buscaria `Order`, mas essa
separação seria acidental, não projetada.

Correção de justificativa: a primeira versão dizia que o `id` do pedido é
enumerável. Não é, `Order.id` é `cuid()`. O token é defesa em profundidade e
dono-do-link, não anti-enumeração.

**CORS.** A afirmação anterior de que tudo é SSR era falsa. São browser-side, e
portanto passam por CORS: o `POST /checkout`, o `POST /orders/status` do polling,
e a revalidação da caixa na montagem (que lê `localStorage`, logo roda no
cliente). SSR de verdade só a vitrine da landing. `garage.casacar.club` precisa
estar em `CORS_ORIGINS`. Atenção: `docs/vercel.md:43` documenta um valor de
bootstrap `CORS_ORIGINS=*`, e como `@fastify/cors` compara por igualdade de
string numa lista, `*` libera nada. Conferir o valor real em produção.

### Admin

**O flag.** `Product.visibleInStore` **não** é o padrão a copiar. Ele é
read-only: está fora de `adminStoreProductCreateSchema` e
`adminStoreProductUpdateSchema` (`packages/shared/src/admin.ts:1030,1049-1066`), é
descartado pelo zod (`routes/admin/store/products.ts:146-149`), aparece na UI como
checkbox `readOnly` e só para produto virtual
(`apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx:239-247`), e o único
escritor é `apps/api/src/scripts/retire-garage-spot-product.ts:58`. A exclusão é
global, não específica de singleton — a primeira versão deste documento leu o
comentário do arquivo em vez do código, e também atribuiu a
`assertVirtualSingletonProtected` uma garantia que ela não dá
(`packages/db/src/garage-spot-product.ts:31-41` só olha slug e nome do tipo).

A pré-venda precisa de um flag **editável**, então o checkbox toca três arquivos
existentes da loja, e isso é escopo declarado:

- `packages/shared/src/admin.ts` — campo nos schemas de create e update.
- `apps/api/src/routes/admin/store/products.ts` — persistência, mais rejeição
  explícita (400) para slugs em `SINGLETON_PRODUCT_SLUGS`, no mesmo formato das
  rejeições de `status` e `productTypeId` em `:133-145`.
- `apps/admin/.../produtos/[id]/product-form.tsx` — a checkbox, para todo
  produto, desmarcada por padrão.

Mesmas permissões de admin que já existem.

**Origem visível.** `Order.origin` tem que aparecer onde um operador olha, senão
é coluna write-only: duas linhas lado a lado na fila a R$100 e R$110 (a
divergência deliberada de taxa) sem como distinguir qual é pré-venda. Entra no
detalhe do pedido (`services/orders/admin-detail.ts` + a página
`(authed)/pedidos/[id]`). Filtro na lista fica de fora por ora.

**Config da campanha.** Tela `/loja/pre-venda`, formulário único. Existe porque a
decisão 3 foi config própria: sem tela, os dados comerciais só entram por deploy.

**Achar o pedido de um convidado.** Isto é obrigatório, não conveniência. A fila
da loja filtra `status: 'paid'` no `baseWhere`
(`services/store/orders.ts:348-353`), então pedido `pending` ou `failed` não
aparece lá por busca nenhuma. E como todo pedido de convidado pende do
usuário-sistema, buscar o email do comprador em `/users` também não acha nada —
o email real está em `PresaleGuest`. Sem isso, "paguei e não recebi" não tem
onde começar.

A mesma tela `/loja/pre-venda` ganha uma busca por email do convidado, listando
pedidos de pré-venda de **qualquer** status com link para `/pedidos/[id]`. Fica
contida na tela nova e não mexe em nenhum arquivo da loja. O detalhe do pedido
(`services/orders/admin-detail.ts`) é kind-agnóstico e já serve, mais a origem e
os dados de `PresaleGuest`.

Reenviar o email de confirmação fica **de fora** por ora, e isso é uma limitação
real: se o envio falhar ou o endereço estiver errado, a única cópia do pedido do
convidado some e não há botão para refazer. O link de status salva o caso em que
a pessoa ainda tem a aba. Anotado como pendência, não resolvido aqui.

### Banco

Toda mudança precisa de migração **commitada** em `packages/db/prisma/migrations/`.
`apps/api/test/global-setup.ts:22` roda `prisma migrate deploy`, não `db push`,
então sem a migração toda a suíte quebra em coluna inexistente.

**`Product`** ganha:

```
visibleInPresale Boolean @default(false)
@@index([visibleInPresale, status])
```

**`PresaleSettings`** — singleton, no padrão de `StoreSettings`:

```
enabled            Boolean @default(false)
shippingFeeCents   Int     @default(0)
deliveryCepRanges  Json    @default("[]")   // [{ from, to }]
deliveryAreaLabel  String?
pickupAddress      String?
pickupHours        String?
firstBatchLabel    String?
```

**`PresaleGuest`** — um por pedido, dono dos dados do comprador sem conta:

```
id            String   @id @default(cuid())
orderId       String   @unique
name          String   @db.VarChar(140)
email         String   @db.VarChar(200)
phone         String?  @db.VarChar(20)
// entrega: nulos quando for retirada
recipientName String?  @db.VarChar(140)
line1         String?  @db.VarChar(140)
number        String?  @db.VarChar(20)
district      String?  @db.VarChar(100)
city          String?  @db.VarChar(100)
stateCode     String?  @db.VarChar(2)
postalCode    String?  @db.VarChar(9)
createdAt     DateTime @default(now())

order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
@@index([email])
```

Tabela própria em vez de `ShippingAddress` porque `ShippingAddress` pende de
`User` e aparece no seletor de endereços do membro. O convidado não tem conta e
não pode escrever ali.

**`Order`** ganha quatro colunas e o pedido de convidado aponta para o
usuário-sistema:

```
origin                   OrderOrigin @default(app)   // enum: app | casa_in_box
clientRequestId          String?     @db.VarChar(64)
checkoutUrl              String?     @db.Text
confirmationEmailSentAt  DateTime?
@@unique([origin, clientRequestId])

presaleGuest PresaleGuest?
```

- `origin` é o registro de origem pedido pelo escopo, e agora é lido no admin.
- `clientRequestId` e `checkoutUrl` são a proteção contra clique duplo, que o
  escopo pediu explicitamente.
- `confirmationEmailSentAt` é o compare-and-set que impede email duplicado. É
  necessário porque a liquidação roda mais de uma vez por pagamento, ver
  "Webhook".
- Nulls são distintos no Postgres, então a unique não afeta pedido existente.

**Usuário-sistema.** Uma linha de `User` criada por seed, email reservado em
domínio próprio, `status: 'disabled'` para ficar fora de qualquer caminho de
login (`packages/shared/src/auth.ts:24` trata `disabled` como inativo), dona de
todos os pedidos de pré-venda de convidado. O email real do comprador vive só em
`PresaleGuest`.

### Serialização

Os serializadores de `routes/store.ts` **não** são reaproveitáveis: todos são
`const` privados do módulo (`:50,58,69,87,146,173`), e o único export do arquivo é
`storeRoutes` em `:320`. Além disso `displayPriceCents` e `devFeePercent` são
campos **obrigatórios** de `storeProductVariantSchema`
(`packages/shared/src/store.ts:113,157`), então a pré-venda não consegue emitir o
formato da loja sem carregar a semântica de taxa que ela justamente não cobra.

A pré-venda tem schema e serializador próprios em
`packages/shared/src/presale.ts`. Duplica cerca de 40 linhas de mapeamento. A
alternativa seria exportar e parametrizar os serializadores da loja, mexendo em
`store.ts`, que é exatamente o arquivo que o anti-goal "a loja não muda de
comportamento" protege.

### Preço e taxa

Toda a loja soma `DEV_FEE_PERCENT` (env, 10% por padrão) por cima de
`Variant.priceCents`, no display (`displayPriceCents`) e na cobrança
(`applyDevFee`). A pré-venda **não** soma: o subtotal é a soma crua de
`priceCents × quantidade`.

Consequência operacional, assumida: um item de R$100 no catálogo aparece como
R$110 na loja do app e R$100 na pré-venda, ao mesmo tempo, para o mesmo SKU.

No código isso aparece como ausência, e ausência não se defende sozinha. Então o
pedido grava `devFeePercent: 0` e `devFeeAmountCents: 0` explicitamente, com
`baseAmountCents == amountCents - shippingCents`, o serializador da pré-venda não
emite preço de display, e um teste trava cada lado da divergência. A coluna
`Order.devFeePercent` tem default 10 (`schema.prisma:1342`), então o zero precisa
ser escrito, não omitido.

Produto com `currency != 'BRL'` é **inelegível**, checado no servidor.
`Product.currency` é por produto (`schema.prisma:1187`) e a sessão Stripe tem uma
moeda só; sem o filtro, um produto em USD seria cobrado como reais pelo mesmo
número de centavos.

### Montagem e persistência

A caixa vive em `localStorage`, separada do `Cart` do servidor. Guarda só
`{ variantId, quantity }`, nunca preço. A chave carrega a campanha e a versão do
formato, e o valor carrega um carimbo de tempo:

- Chave `ccc.presale.<campaignId>.v1`. Campanha nova não ressuscita caixa velha.
- TTL de 14 dias. Caixa expirada é descartada em silêncio, sem lista de avisos.
- Toda escrita em `try/catch`, com degradação para estado em memória. Safari
  privado e quota cheia fazem `setItem` lançar, e isso não pode derrubar a
  página na hora em que a pessoa adiciona o primeiro item.
- A página escuta o evento `storage` para não divergir entre abas. Sem isso,
  duas abas montam caixas diferentes, a última escrita vence, e pagar numa aba
  apaga a caixa que a outra ainda mostra na tela.
- `clientRequestId` **nunca** é persistido junto da caixa, ver "Clique duplo".

Ao carregar, revalida contra `GET /products`: item fora da elegibilidade,
variante inativa ou produto despublicado vira aviso nomeando o item, e a pessoa
revisa antes de seguir. Preço sempre vem do servidor.

Voltar da Stripe cai em `cancel_url` → `/casa-in-box/montar`, com a caixa intacta
porque nunca saiu do `localStorage`. Só limpa na confirmação de pagamento.

### Recebimento

- **Retirada na Pocket CASA** → `fulfillmentMethod: 'pickup'`, `shippingCents: 0`,
  sem endereço.
- **Entrega em Curitiba e região** → `fulfillmentMethod: 'ship'`, CEP validado
  contra `PresaleSettings.deliveryCepRanges`, frete de
  `PresaleSettings.shippingFeeCents`, endereço gravado em `PresaleGuest`.

CEP fora das faixas bloqueia a entrega, com mensagem explicando a área e
oferecendo a retirada. Valida no cliente para feedback e de novo no servidor como
autoridade.

A checagem de faixa é função nova de 8 linhas no serviço de pré-venda.
`isFreeShippingCep` (`services/box/charge.ts:4-15`) faz a mesma aritmética, mas é
código do Box mensal, e a regra do repositório é não mexer em código fora da
tarefa. Duplicação deliberada, anotada no código.

### Checkout

`POST /presale/casa-in-box/checkout`.

**Dentro de uma transação**, e só isto:

1. Valida campanha ativa.
2. Carrega variantes por id, com produto e tipo. Rejeita, com código tipado e a
   lista de `variantId` ofensores: produto não `active`, `visibleInPresale:
false`, `virtual: true`, `currency != 'BRL'`, variante inativa, quantidade
   fora de 1..20.
3. Valida recebimento contra `allowPickup`/`allowShip` do produto e contra a
   config da campanha.
4. **Recalcula** subtotal, frete e total a partir do banco. O que o cliente
   mandou de preço é ignorado.
5. Compara o total recalculado com o `expectedTotalCents` que o cliente mandou.
   Divergiu, devolve 409 com o total novo e a composição revalidada, e **não**
   cria pedido nem sessão. Sem isso, um preço alterado enquanto a pessoa
   preenche o endereço faz ela ver R$240 no resumo e R$290 na Stripe, que é o
   anti-goal do total divergente. A revalidação só no carregamento da página não
   cobre essa janela.
6. Total zero ou abaixo do mínimo da Stripe em BRL devolve 422 com mensagem
   própria, não uma falha genérica de pagamento. É o mesmo cuidado que
   `routes/cart.ts:678-699` tomou depois de o membro receber "Erro ao iniciar o
   pagamento" sem saída.
7. Cria `Order` (`kind: 'product'`, `origin: 'casa_in_box'`, `method: 'card'`,
   `provider: 'stripe'`, `status: 'pending'`, `userId` do usuário-sistema,
   `devFeePercent: 0`), os `OrderItem` com `unitPriceCents`/`subtotalCents`
   finais, e a linha `PresaleGuest`.
8. **`expiresAt` fica nulo.** Como não há reserva, expirar o pedido não libera
   nada e só cria a pior falha possível: o worker
   (`workers/order-expiry.ts:124`, de minuto em minuto) mata o pedido enquanto a
   pessoa termina o 3DS, e o webhook que chega depois estorna com
   `'order-expired'` (`routes/stripe-webhook.ts:917-921`) sem avisar ninguém. O
   cartão foi debitado, a página diz que expirou, e o dinheiro volta em dias
   úteis. O worker filtra `expiresAt: { not: null }`, então nulo o mantém fora.
   Quem fecha a janela é o `expires_at` da própria sessão Stripe.

**Depois do commit**, nunca dentro dele:

9. Cria a sessão com `idempotencyKey: presale_checkout_<orderId>`,
   `metadata.orderId` e `expires_at = Math.floor((Date.now() + 30min)/1000)`,
   **recalculado na hora da chamada**, como `routes/cart.ts:798`.
10. Grava `checkoutUrl` e devolve.

Duas coisas nessa fronteira não são estilo, são dinheiro:

- **A chamada da Stripe fica fora da transação.** Um timeout de transação
  interativa abortando depois de a Stripe já ter criado a sessão deixaria uma
  sessão pagável apontando para um `orderId` que sumiu no rollback. O webhook não
  trata `OrderNotFoundError` (`routes/stripe-webhook.ts:891-928` cobre quatro
  tipos, esse não está entre eles), então o pagamento seria capturado e o webhook
  entraria em 500 eterno. `routes/cart.ts:883` chama a Stripe depois do commit
  pelo mesmo motivo.
- **`expires_at` não é derivado de nenhum carimbo anterior.** A Stripe exige no
  mínimo 30 minutos a partir da criação da sessão; reaproveitar um carimbo feito
  alguns passos antes dá sempre um valor curto, e todo checkout tomaria 400.

Falha ao criar a sessão → o pedido criado é marcado `failed` (não há reserva para
devolver). A página mostra erro e mantém a caixa.

**Clique duplo.** O cliente gera um `clientRequestId` aleatório **por tentativa
de envio**, guardado em memória, reusado só se a mesma tentativa for repetida. A
unique `(origin, clientRequestId)` faz a segunda chamada bater em P2002. No P2002
o servidor devolve o `checkoutUrl` do pedido existente **somente se** esse pedido
ainda estiver `pending`; caso contrário responde 409 com código próprio e o
cliente refaz com id novo.

Três armadilhas que o desenho evita de propósito, todas apontadas na revisão:

- **O id nunca é derivado da composição.** Se fosse, dois convidados montando a
  mesma caixa colidiriam, e o segundo receberia a sessão do primeiro: pagaria o
  pedido alheio e ficaria sem pedido e sem email.
- **O id nunca vive no `localStorage`.** Rehidratado, faria o POST de uma
  composição nova devolver a sessão da composição velha, cobrando o valor antigo.
- **Sessão morta não vira beco sem saída.** Sem a checagem de status, voltar
  depois com a mesma caixa devolveria para sempre a URL de uma sessão expirada,
  que bate no `cancel_url` e volta para a montagem em laço. O carrinho resolve o
  equivalente versionando a chave, e o próprio repo descreve essa falha em
  `routes/stripe-webhook.ts:450-457`.

**Rejeição e recuperação.** Todo 409/422 do checkout carrega código tipado e os
itens ofensores, e a montagem reage revalidando e marcando os itens na tela. Sem
isso, um produto despublicado no meio da sessão produz erro genérico, a caixa
continua mostrando o item morto, e o segundo clique dá o mesmo erro, sem saída
além de recarregar na mão.

### Webhook

A afirmação "nada novo no webhook" era **falsa**. Três mudanças são necessárias,
todas restritas a pedidos com `origin: 'casa_in_box'` para não alterar o
comportamento de ingresso, box ou loja:

1. **`payment_intent.payment_failed` não encerra pedido de pré-venda.** Hoje
   `routes/stripe-webhook.ts:973-999` flipa `pending → failed` para qualquer
   pedido sem `cartId`. Em Checkout hospedado um PI recusado não é terminal: a
   sessão segue aberta e a pessoa tenta outro cartão. Com o flip, a segunda
   tentativa bem-sucedida chega em `checkout.session.completed`, `settlePaidOrder`
   lança `OrderNotPendingError` (`services/orders/settle.ts:79-81`), e o catch em
   `:912-927` só trata `expired` e `paid` — `failed` cai no `throw err` de `:928`
   e vira 500. A Stripe retenta por três dias, sempre 500. Dinheiro capturado,
   pedido `failed`, nenhum email. O cartão recusado é o modo de falha mais comum
   no Brasil, então isso aconteceria no primeiro dia.
2. **`failed` tratado no catch de `OrderNotPendingError`**, como rede de
   segurança: se por qualquer caminho o pedido chegou a `failed` e a Stripe diz
   que o pagamento entrou, a verdade é o dinheiro. Liquida e registra.
3. **Debitar `Variant.quantitySold` na liquidação**, só para `origin:
'casa_in_box'`, dentro da transação que flipa para `paid` em
   `services/orders/settle.ts:83-99`. Sem guarda de teto, passar do total é
   permitido e logado.

O dedupe por `PaymentWebhookEvent` continua valendo para o mesmo `event.id`, mas
não resolve o resto, ver abaixo.

### Confirmação

**A liquidação roda mais de uma vez por pagamento.** A primeira versão dizia o
contrário. Dois fatos a derrubam:

- `markProcessed` roda **depois** do dispatch, de propósito, com comentário
  explícito em `routes/stripe-webhook.ts:17-22`. Reentrega sempre reexecuta o
  dispatch; só o booleano `firstTime` sabe que foi repetição.
- `createCheckoutSession` põe metadata na sessão **e** no PI
  (`services/stripe/index.ts:461,474`), então `payment_intent.succeeded`
  (`stripe-webhook.ts:677`) e `checkout.session.completed` (`:817`) liquidam o
  mesmo pedido sob `event.id` diferentes. A unique de `PaymentWebhookEvent` não
  dedupa entre tipos de evento.

Por isso o email tem dedupe próprio: compare-and-set em
`confirmationEmailSentAt` com `updateMany({ where: { id, confirmationEmailSentAt:
null } })`, e só envia se o count for 1. Falha de envio não reverte nem bloqueia o
pedido: loga e segue.

**O que o email contém.** Composição, totais, forma de recebimento e o link de
status. **Não** repete o endereço completo. O email não é verificado, por decisão
de conversão, então um erro de digitação mandaria nome, telefone e endereço de
rua para um terceiro não envolvido — divulgação que o controlador originaria.

`/casa-in-box/obrigado` faz polling de `POST /orders/status` e cobre **quatro**
estados, não três: `pending` (em processamento, com aviso de que pode levar
instantes), `paid` (confirmado, com composição e dados de recebimento),
`refunded` (estornado, estado que o link favoritado vai encontrar quando um
admin estornar dias depois), e `failed`/`expired`/`cancelled` (explica e oferece
montar de novo). A tela de confirmação da loja vive no mobile autenticado
(`apps/mobile/app/(app)/events/buy/checkout-return.tsx`) e não comporta convidado
na web.

## LGPD, e o que falta antes de abrir

A pré-venda cria uma **categoria nova de titular** (comprador sem conta) e uma
**atividade nova de tratamento**. Nenhum dos artefatos de compliance do projeto
cobre isso hoje, e `docs/ropa.md:3` obriga revisão "on any new processing activity
or material change". Itens de release, não de implementação:

- **ROPA** (`docs/ropa.md`): entrada nova. `PAY-01`/`PAY-02` cobrem só ingresso.
- **Política de privacidade** (`packages/shared/src/legal.ts`): §3 e §4 descrevem
  coleta em torno de criação de conta e não têm base legal para compra de
  convidado. `PRIVACY_POLICY_VERSION` sobe.
- **Página de privacidade e termos em `garage.casacar.club`.** Hoje o garage só
  tem `g/[slug]` e `not-found`; o texto canônico é servido pelo admin. Um
  checkbox de consentimento apontando para documento que o titular não consegue
  ler na página que coleta não é consentimento informado.
- **Retenção.** `workers/retention.ts` não tem regra para convidado que abandonou
  o checkout. Precisa de uma: purga de `PresaleGuest` + `Order` não pago depois
  de N dias. Sem reserva de estoque, o pendente não custa nada, mas o dado
  pessoal fica.
- **`Consent.evidence`** é obrigatório sem default (`schema.prisma:1958`). O
  insert precisa preencher.
- **IP como evidência é fraco** enquanto `trustProxy` estiver desligado: grava o
  proxy do Railway, igual para todos. Registrar mesmo assim, sabendo que não
  serve como prova.

**Limitação pré-existente, não consertada aqui** (regra 3 do CLAUDE.md, código
fora da tarefa): `services/account-deletion/anonymize.ts` nunca apaga nem limpa
`ShippingAddress`, e mantém a linha de `User` viva de propósito para a FK fiscal
dos pedidos (`:128`), então o `onDelete: Cascade` nunca dispara. Isso não piora
com este trabalho, porque o convidado não escreve em `ShippingAddress` — mas a
nova `PresaleGuest` precisa entrar na rotina de anonimização quando ela for
consertada. Anotado como pendência.

## Chamadas que eu fiz

- Produtos `virtual: true` nunca são elegíveis, mesmo com o flag marcado.
- Produtos em `SINGLETON_PRODUCT_SLUGS` são rejeitados com 400 no admin.
- Campanha desligada responde 404 nas três páginas, em vez de "em breve".
- Teto de 20 unidades por variante, mínimo 1.
- Token do pedido viaja por POST, não por querystring.
- `expiresAt` nulo no pedido de pré-venda.
- A página de confirmação é nova.
- `cepInRanges` duplica 8 linhas em vez de extrair utilitário compartilhado.
- Filtro de origem na lista de pedidos fica de fora; só o detalhe mostra.
- Busca por email do convidado mora na tela nova de pré-venda, não na fila da
  loja, para não mexer no `baseWhere` que a loja usa.
- Reenvio do email de confirmação fica de fora.

## Achados da revisão que eu recusei

- **"`clientRequestId` é escopo não pedido."** O escopo pediu, literalmente:
  "Proteja a criação do checkout contra cliques duplicados". Botão desabilitado
  cobre o caso comum, não o POST repetido. Mantido, com as três armadilhas
  fechadas.
- **"`PresaleSettings` é escopo não pedido."** Decorre da decisão 3 do dono do
  produto. Mantido.
- **Estorno não devolve estoque** (`routes/stripe-webhook.ts:650-656` flipa
  `paid → refunded` e revoga ingresso, sem mexer em `Variant`). Confirmado e
  real, mas **pré-existente**: vale igual para pedido de produto da loja. Fora
  desta tarefa. Com a decisão 7, a pré-venda debita no pagamento, então um
  estorno deixa o saldo debitado — operação resolve na fila do primeiro lote.
  Anotado como pendência.
- **`providerRef` nulo durante o pendente** impede cancelar a sessão
  (`workers/order-expiry.ts:105`). Confirmado, mas é paridade com o fluxo
  hospedado do carrinho, que também nasce sem `providerRef` porque sessão em modo
  `payment` devolve `payment_intent: null`. Com `expiresAt` nulo, deixa de
  importar: quem fecha a janela é o `expires_at` da sessão.

## Visual

Fundo escuro, detalhes dourados, fotografia de produto em destaque. Mobile
primeiro: leitura e CTA acima da dobra, resumo da caixa fixo e acessível.

**A paleta do garage não é a do `packages/design`.** `apps/garage/app/globals.css`
define `--color-bg: #0b0b0f` e `--color-accent: #d4af37`, e pinta o body
`#050506`, deliberadamente mais escuro para a coluna de 430px ler como janela. Os
tokens (`goldDeep #C9A227`, `goldLight #E8CE86`, `bg #0A0A0A`) existem, mas em
outro ramp. A landing usa as variáveis do garage e **acrescenta** as que faltarem
ali, em vez de importar números do pacote de design e ficar com dois dourados
discordantes na mesma origem.

**Viewport.** O garage não declara `viewport` nem usa `env(safe-area-inset-*)`.
Uma barra fixa de pagamento em `bottom: 0` cai sob o home indicator do iPhone e
atrás da toolbar que colapsa no Safari. A landing declara `viewport-fit=cover` e
a barra respeita `safe-area-inset-bottom`.

**A foto da caixa** vai em `apps/garage/public/`, não em
`packages/design/assets`. Nenhum app Next consome os assets daquele pacote (os
dois usos são `require()` do Metro no mobile), o garage não tem `public/` hoje, e
o campo `files` do `packages/design/package.json` lista `assets/*.webp`, que não
casa com subpasta. Usada no hero com a legenda de composição ilustrativa.

## Copy (PT-BR)

- Título: "A cultura da CASA, em uma caixa que você monta."
- Texto: "Escolha os produtos da CASA Car Club que vão na sua Casa In Box e
  garanta a sua na pré-venda."
- CTA: "Montar minha caixa" — no hero e de novo depois do "como funciona".
- Três passos: escolhe os produtos → paga na pré-venda → recebe no primeiro lote
  ou retira na Pocket CASA.
- Vitrine de exemplos de `GET /products`, com a legenda de que a foto ilustra uma
  composição e o conteúdo é escolhido pelo cliente.
- FAQ curto: pagamento, retirada, entrega, previsão do primeiro lote. Valores de
  `PresaleSettings`; campo vazio não renderiza a pergunta.

Copy num módulo único (`copy/presale.ts`), no padrão de
`apps/mobile/src/copy/caixa.ts`, para o scaffold de i18n.

## Testes

**O harness do garage é só Node.** `apps/garage/vitest.config.ts:20` usa
`environment: 'node'`, sem jsdom e sem `@testing-library/*`, e todo teste de
componente existente usa `renderToStaticMarkup`. Então a lógica de montagem
(revalidação, faixa de CEP, subtotal, TTL do `localStorage`) mora em módulos
puros testados em Node, e os componentes ficam finos. Nada de teste de DOM sem
antes decidir adicionar a dependência, o que seria tarefa própria.

- API, com Postgres real (Testcontainers, como o resto da suíte; Docker tem que
  estar rodando): elegibilidade pelo flag, recálculo ignorando o preço do
  cliente, `expectedTotalCents` divergente devolvendo 409 sem criar pedido, CEP
  dentro e fora, clique duplo devolvendo o mesmo pedido, P2002 em pedido não
  pendente devolvendo 409, debito de estoque na liquidação, webhook reenviado
  liquidando e enviando email **uma vez só**, `payment_intent.payment_failed`
  seguido de `checkout.session.completed` liquidando em vez de 500, produto em
  moeda != BRL recusado, total zero recusado com mensagem própria.
- Unidade: aritmética de subtotal/frete/total, faixa de CEP, serialização,
  assinatura e verificação do token com o kind novo.
- Explícito: o total da pré-venda **não** carrega o dev fee e o da loja carrega.
  Um teste por lado, senão a divergência some numa refatoração futura.
- Regressão: a suíte existente da loja, do carrinho e do garage passa.

## Dados comerciais pendentes

A campanha nasce `enabled: false`. Antes de abrir, preencher no admin:

1. Endereço completo da Pocket CASA e horário de retirada.
2. Faixas de CEP atendidas por entrega.
3. Valor do frete.
4. Previsão do primeiro lote.
5. Quais produtos recebem o flag (a lista virá depois).
6. Remetente e assunto do email, se os padrões do `Mailer` não servirem.

## Checklist de deploy

1. Migração commitada em `packages/db/prisma/migrations/`.
2. Seed do usuário-sistema e do singleton `PresaleSettings`.
3. `CORS_ORIGINS` da API inclui `garage.casacar.club`. Conferir o valor real: `*`
   numa lista não libera nada.
4. **`NEXT_PUBLIC_API_BASE_URL` setado no projeto Vercel do garage.**
   `apps/garage/next.config.mjs:22` cai em `http://localhost:4000` em silêncio, e
   a falha só aparece no clique de pagar, do celular do comprador.
5. Entrada no ROPA, política de privacidade publicada, páginas de privacidade e
   termos acessíveis em `garage.casacar.club`.

## Deixado para quem implementa

- Organização interna dos componentes React e dos serviços da API.
- Forma exata do payload do `POST /checkout`, desde que carregue
  `expectedTotalCents` e o servidor recalcule tudo.
- Intervalo e teto do polling da confirmação.
- Layout fino da landing dentro da identidade descrita.
