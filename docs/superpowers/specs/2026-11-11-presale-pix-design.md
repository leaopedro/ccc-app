# Pix na pré-venda Casa In Box — design

Data: 2026-11-11. Autor: Claude, a partir de conversa com o Pedro.

## Intenção

A pré-venda da Casa In Box entrou em produção aceitando só cartão, via Stripe
Checkout hospedado. Falta Pix, que no Brasil é como boa parte do público prefere
pagar e, para uma venda avulsa, costuma sair mais barato para a casa.

O jeito como a pessoa paga Pix é diferente de cartão, e é isso que governa quase
todas as decisões abaixo: **ela copia um código e sai do nosso site para pagar no
app do banco.** Não existe redirecionamento de volta. O pedido fica pendente
enquanto ela decide, e quem avisa que pagou é o webhook do provedor, não o
navegador dela.

## Por que agora

A pré-venda está pronta mas ainda não foi aberta. Entrar com os dois meios de
pagamento desde o primeiro dia evita ter que explicar depois por que a primeira
leva não tinha Pix.

## Objetivos

- O comprador escolhe entre cartão e Pix antes de pagar.
- Escolhendo Pix, ele vê o código copia-e-cola na nossa página.
- **Ele recebe o código por email assim que é gerado**, para não perder a compra
  ao fechar a aba. O link dessa página continua acessível.
- O código vale por **1 hora**.
- Quem pagar depois de 1 hora tem a compra honrada, não estornada.

## Não-objetivos

- Pix recorrente, parcelado, ou Pix via Stripe.
- QR code desenhado na tela. O `brCodeBase64` existe na resposta do provedor, mas
  copiar-e-colar é o que o Pedro descreveu e é o que a primeira versão entrega.
- Mudar qualquer coisa do caminho de cartão, que está em produção e revisado.
- CPF do comprador. O provedor aceita cobrança sem `customer`, e é assim que o
  carrinho já faz hoje (`routes/cart.ts:743`). Não vamos coletar documento novo
  sem necessidade: isso abriria entrada nova de dado pessoal no ROPA.

## Anti-objetivos

Coisas que fariam isso falhar mesmo "funcionando":

- Comprador pagar e a página nunca sair de "pendente".
- Comprador perder o código e não ter como recuperá-lo.
- Pedido pago ser recusado por causa do nosso relógio.
- Qualquer regressão no caminho de cartão.

## Restrições

Herdadas do que já existe, e todas verificadas no código:

- `Order.brCode`, `providerRef`, `expiresAt` e `origin` **já existem**
  (`schema.prisma:1397,1398,1407,1414`), e `expired` já é um `OrderStatus`.
  Para guardar código e prazo, nenhuma migração é necessária.
- **Uma migração É necessária**, por outro motivo (achado na revisão do design):
  o email do código Pix precisa de dedupe próprio, e `confirmationEmailSentAt`
  já é do email de confirmação de pagamento. Reaproveitar aquela coluna faria o
  email do código bloquear para sempre o email de confirmação do mesmo pedido.
  Coluna nova, anulável, só para isso.
- O cliente AbacatePay já aceita `expiresInSeconds`
  (`services/abacatepay/index.ts:29`).
- O `pix-reconcile` varre a janela `[3min, 48h]`, então uma cobrança de 1 hora
  está coberta. O `REPLAY_WINDOW_MS` do webhook é 24h.
- `GRACE_MS = ORDER_EXPIRY_MS / 5` = 3 min. Com janela de 1h, cada checkout Pix
  abandonado é varrido por ~57 minutos em vez dos ~12 do carrinho: cerca de 5x
  mais chamadas ao provedor por abandono. Aceitável no volume de pré-venda,
  registrado aqui para não virar hábito silencioso.
- A chamada ao provedor acontece fora de qualquer transação Prisma.
- Pedido só vira `paid` por webhook verificado.
- Copy PT-BR em `apps/garage/src/copy/presale.ts`, nunca literal solto.

## O que foi decidido, e por quem

### Provedor: AbacatePay (decisão do Pedro)

Stripe oferece Pix para contas brasileiras, e como a pré-venda não passa
`payment_method_types`, habilitar Pix no Dashboard faria o método aparecer sem
uma linha de código. O Pedro optou por AbacatePay, que é o que o `brainstorm.md`
já definiu para Pix avulso e o que o repo tem integrado. Fica registrado que a
alternativa existe, caso as taxas mudem a conta.

### Janela de 1 hora (decisão do Pedro)

`ORDER_EXPIRY_MS` é 15 minutos e serve o carrinho. Não serve aqui: mandamos o
código por email, e 15 minutos mata a cobrança antes de muita gente abrir a
caixa de entrada. `expiresInMs` já é parâmetro por fluxo no checkout do carrinho,
com comentário dizendo que cada chamador escolhe o seu.

### Pagamento atrasado é honrado (recomendação minha, aceita)

O `pix-reconcile` já detecta "expirado localmente mas pago no provedor" e emite
alerta único. O carrinho deliberadamente **não** liquida nesse caso, e o motivo
está no comentário: o `order-expiry.ts` já devolveu o estoque reservado, então
liquidar venderia algo que voltou para a prateleira.

**A pré-venda não reserva estoque nenhum.** O motivo do carrinho não existe aqui.

Recusar custaria três caminhos novos (detectar, estornar, avisar), cada um com
falha própria, para entregar o pior resultado possível: quem pagou fica sem nada
e esperando dinheiro de volta.

**A regra tem que ser escrita pelo motivo, não pelo rótulo.** Condicionar em
"é pré-venda" repete uma classe de bug que já mordeu este repo: rota chaveada por
`provider` e cega a `kind`, segura só por acidente. A condição correta é "este
pedido não reservou estoque".

### `expiresAt` deixa de ser sempre nulo

Hoje é invariante do plano da pré-venda que `Order.expiresAt` seja nulo, porque
não há reserva e porque nulo mantém o `order-expiry.ts` longe do pedido no meio
do 3DS. Com Pix isso muda: pedido Pix recebe `expiresAt = criação + 1h`; pedido
cartão continua nulo.

**Isso tem que ser escrito no plano e no código.** A invariante antiga está
documentada e alguém vai confiar nela.

## O fluxo

1. Comprador escolhe tier, recebimento, consente, e escolhe **cartão ou Pix**.
2. `POST /presale/casa-in-box/checkout` passa a receber o meio de pagamento.
3. **Cartão:** comportamento idêntico ao de hoje.
4. **Pix:** cria o pedido, chama `createPixBilling` com `expiresInSeconds: 3600`,
   grava `providerRef` e `brCode`, grava `expiresAt`, dispara o email com o
   código, e responde com o código e o prazo em vez de uma URL de redirecionamento.
5. A página mostra o código, um botão de copiar, e quanto tempo resta.
6. Comprador paga no banco. Webhook liquida. A página, que está em polling, vira
   paga sozinha, e o email de confirmação sai.
7. Webhook perdido: o `pix-reconcile` pega dentro de 48h, **e o comprador é
   avisado** (ver "Avisar quem pagou" abaixo).
8. Ninguém pagou: a cobrança morre no provedor e o pedido vira `expired`.

## Avisar quem pagou (achado na revisão do design)

Duas lacunas reais, que sem conserto fazem a pré-venda honrar o pagamento no
banco de dados e deixar o comprador sem saber:

- `sendPresaleConfirmationEmail` só é chamado de `stripe-webhook.ts`, em quatro
  pontos. Nem `abacatepay-webhook.ts` nem `pix-reconcile.ts` chamam. Pagamento
  por Pix não dispara email de confirmação nenhum hoje.
- `notifyRecoveredOrder`, no `pix-reconcile.ts`, só notifica
  `kind: 'ticket' | 'extras_only'`. Pedido de pré-venda é `kind: 'product'`,
  então uma recuperação tardia não avisa ninguém além do Sentry.

As duas entram no escopo. Sem elas o objetivo "quem pagar depois de 1h tem a
compra honrada" é verdade só para o nosso banco, não para quem pagou.

## Decisões minhas, tomadas na revisão do design

Três perguntas vieram da revisão. Nenhuma precisa do Pedro; estão resolvidas
aqui, marcadas como minhas para ele poder discordar.

**Estender os schemas existentes, não criar endpoint paralelo.** O
`presaleCheckoutRequestSchema` ganha `paymentMethod`, com cartão como padrão
para não quebrar chamador existente. O `checkoutUrl` do response, hoje
obrigatório, passa a ser resposta discriminada por método: cartão devolve URL,
Pix devolve código e prazo. O `presaleOrderStatusResponseSchema` ganha os campos
do Pix. Um endpoint paralelo duplicaria recálculo, elegibilidade, criação de
convidado e consentimento — justamente as partes difíceis e já revisadas. O
não-objetivo "não mexer no caminho de cartão" é sobre comportamento, e estender
schema com campo opcional não muda comportamento nenhum de cartão.

**Email e push de recuperação saem dos caminhos do AbacatePay, não de dentro do
`settlePaidOrder`.** Centralizar no `settlePaidOrder` alcançaria ingresso e caixa
junto, e este repo já levou um achado exatamente assim: envio não escopado
carimbando pedido comum da loja. Chamar explicitamente de
`abacatepay-webhook.ts` e `pix-reconcile.ts`, escopado por `origin`, repete o
padrão que o `stripe-webhook.ts` já usa e mantém o raio pequeno.

**Coluna nova para o dedupe do email do código**, anulável, com o mesmo
compare-and-set de `confirmationEmailSentAt`. Não reaproveitar a existente.

## O que fica para quem constrói

- Onde exatamente o seletor de método entra na página de venda.
- Formato e texto do email do código, seguindo `confirmation-email.ts`, inclusive
  o dedupe por compare-and-set que ele já usa.
- Como a página de obrigado apresenta código, prazo e estado. O teto de polling
  de 60s foi dimensionado para cartão e não serve para Pix; quem constrói escolhe
  entre acompanhar enquanto a cobrança vive ou parar e confiar no link do email.
- Se o seletor some quando só um método está configurado.

## Como saber que funcionou

Uma compra de verdade, do começo ao fim: escolher Pix, receber o email, copiar o
código, pagar no banco, e ver a página virar paga sozinha. Depois uma que ninguém
paga, confirmando que expira sem drama. Nenhum teste substitui essas duas —
foi exatamente em costuras mockadas que os piores bugs da pré-venda se
esconderam.
