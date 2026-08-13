# Spec A — Stripe live na web

**Data:** 2026-08-12
**Status:** aprovado, aguardando plano de implementação
**Depende de:** `2026-08-12-billing-fixes-design.md` (Fase 0), fechado
**Subprojetos irmãos:** `2026-08-12-ios-review-blockers-design.md`,
`2026-08-12-apple-pay-ios-design.md`

## Objetivo

Passar a receber pagamentos reais no `app.casacar.club`: cartão avulso via
Stripe, Pix avulso via AbacatePay, e assinatura recorrente via Stripe.

Hoje produção roda inteira em modo test. Nenhuma cobrança real aconteceu.

## Escopo

Dentro:

- Cartão avulso (carrinho de ingressos e loja) via Stripe Checkout hospedado.
- Pix avulso via AbacatePay.
- Assinatura recorrente (planos Bronze/Silver/Gold e add-ons) via Stripe.

Fora:

- Stripe Tax e nota fiscal. Ver "Bloqueadores jurídicos".
- Qualquer pagamento dentro do app iOS.
- Correções de código de billing. São a Fase 0, e este spec depende delas.

## Contexto

Infra de produção no ar: API no Railway, admin na Vercel, app web em
`app.casacar.club`.

Atenção: o perfil `production` do `apps/mobile/eas.json` aponta
`EXPO_PUBLIC_API_BASE_URL` para `https://ccc-app-production.up.railway.app`, não
para `api.casacar.club`. Confirmar qual domínio a API atende antes de registrar
webhooks, senão as entregas vão para um host que pode mudar.

A conta Stripe é a conta pessoal do Pedro, pessoa física, já operante e
compartilhada com outro negócio. Não há onboarding novo.

`docs/stripe.md` e `docs/revenuecat.md` descrevem a configuração da JDM
Experience e serão reescritos.

## Bloqueadores jurídicos

Não são trabalho de engenharia, e travam o go-live do mesmo jeito.

**Entidade e merchant of record.** O CNPJ existe e é do Pedro, não ligado à JDM.
A conta Stripe está em pessoa física, e a decisão registrada é seguir assim por
ora. Isso cria uma divergência: quem recebe o dinheiro é a PF, quem os documentos
legais do app nomeiam é o CNPJ, e a nota fiscal sairia por um CNPJ que não
recebeu. Pendência aberta com dono definido, a resolver quando a conta migrar.

**Placeholders publicados hoje.** `packages/shared/src/legal.ts:17-19` está no ar
com `CNPJ: a ser publicado antes do lançamento em produção` e o mesmo para
endereço. Preencher com a razão social real do CNPJ antes da primeira cobrança.

**Termos não existem.** Tratado em
`2026-08-12-ios-review-blockers-design.md`, mas também trava a web: toda
transação paga aconteceria sob contrato nunca publicado.

**Política de reembolso e direito de arrependimento.** Não existe nada no
repositório sobre reembolso, estorno, arrependimento ou prazo de sete dias. A
página de assinatura vende "cancele quando quiser" sem política por trás. Venda a
distância no Brasil exige política publicada e o prazo de arrependimento
informado no fechamento.

**Nota fiscal.** Zero ocorrências no repositório. Stripe Tax é cálculo de
imposto, não emissão de documento fiscal. Vender ingresso, box física e produto
de loja gera obrigação de emissão por venda, a partir da primeira. Decisão
explícita necessária: emitir desde o dia um via integração, ou aceitar a
exposição com dono e prazo datados.

**Política de privacidade fica falsa no go-live.** `legal.ts:60` diz ao usuário
que assinaturas premium são geridas pela RevenueCat, e a tabela de
subprocessadores em `:96-98` lista a RevenueCat como Operador. Este spec move
assinatura para a Stripe. Atualizar o texto, subir a versão da política, e
decidir se exige novo consentimento.

**Fanout de exclusão sem AbacatePay.**
`apps/api/src/services/account-deletion/vendor-fanout.ts` cobre Stripe, Expo,
Sentry e Resend. A AbacatePay é Operador nomeado na política e não está lá.
Adicionar, mesmo que resolva como `skipped` com motivo documentado.

## Arquitetura

Nenhuma mudança neste spec. Os pontos load-bearing que a operação precisa
respeitar:

**Três webhooks, com paths que não seguem padrão único.** Conferidos no código,
não nos docs antigos. Nenhum tem prefixo (`apps/api/src/app.ts:156-159`):

| Rota                       | Secret                          | Cobre                        |
| -------------------------- | ------------------------------- | ---------------------------- |
| `/stripe/webhook`          | `STRIPE_WEBHOOK_SECRET`         | Avulso (carrinho, ingressos) |
| `/webhooks/stripe-billing` | `STRIPE_BILLING_WEBHOOK_SECRET` | Assinatura                   |
| `/abacatepay/webhook`      | `ABACATEPAY_WEBHOOK_SECRET`     | Pix avulso                   |

**A AbacatePay autentica por segredo na query string, não por header.**
`routes/abacatepay-webhook.ts:209-217` compara
`request.query.webhookSecret` em tempo constante. Registrar a URL sem
`?webhookSecret=<valor>` faz toda entrega retornar 401. Isso sozinho quebra o
go-live do Pix.

**Pedido só vira `paid` por webhook verificado.** Dedupe por id de evento do
provedor, com constraint única no banco, não leitura seguida de escrita.

**`GROWTH_PREMIUM_BILLING_ENABLED` é o interruptor.** O default no código é
`true`; no Railway precisa estar `false` até o smoke de avulso passar. Ela é
global, não por plataforma, e também silencia o worker de reconciliação
(`workers/billing-reconcile.ts:239`).

## Frentes de trabalho

### 1. Configuração na Stripe, live mode

Um Product por plano (Bronze, Silver, Gold) e um por add-on. Um Price recorrente
mensal em BRL por produto.

- Todos os Prices, plano e add-on, no mesmo intervalo e moeda. Misturar faz a
  Stripe recusar a sessão combinada, e a API traduz para 503.
- Metadata `devFeePercent` obrigatória em todo Price de **plano**. Omitir grava o
  split como `0` na invoice e na membership, silenciosamente
  (`stripe-billing-webhook.ts:56` retorna 0 sem alertar quando o campo é
  `undefined`). A linha da invoice é a fonte da verdade e nunca é re-derivada do
  env.
- Metadata `baseAmountCents` igual ao `unit_amount`. Correção de atribuição: o
  webhook **não** lê esse campo, ele usa o catálogo do banco
  (`stripe-billing-webhook.ts:153`). Quem lê é `premium-pricing.ts:86` e o worker
  de reconciliação. Continua valendo preencher, mas não é o webhook que impõe.
- **Descritor de fatura da conta como `CASA CAR CLUB`**, antes da primeira
  cobrança. A conta é pessoal e o `docs/stripe.md` atual configura `JDM PREMIUM`.
  Descritor errado fabrica exatamente as disputas que a Fase 0 passou a tratar.

Portal de billing habilitado, com cancelamento ao fim do período e histórico de
invoices.

### 2. Webhooks live

Registrar as três rotas apontando para o domínio confirmado, com o path exato da
tabela, e a query string do segredo no caso da AbacatePay.

**Antes de criar qualquer endpoint live, ler a versão de API do endpoint de test
no dashboard e criar os live fixados na mesma versão.** Motivo em
`2026-08-12-billing-fixes-design.md` §C2. É leitura de trinta segundos e é gate.

Endpoint de billing, cinco eventos: `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`charge.refunded`.

Endpoint de avulso, os cinco que o handler trata hoje
(`checkout.session.completed`, `checkout.session.expired`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`)
mais os dois que a Fase 0 adiciona: `charge.dispute.created` e
`charge.dispute.closed`. Os dois de `payment_intent` ficam ociosos até o Apple
Pay, e registrá-los agora evita voltar ao dashboard.

### 3. Variáveis no Railway

| Variável                            | Valor                                |
| ----------------------------------- | ------------------------------------ |
| `STRIPE_SECRET_KEY`                 | `sk_live_...`                        |
| `STRIPE_PUBLISHABLE_KEY`            | `pk_live_...`                        |
| `STRIPE_WEBHOOK_SECRET`             | novo, do endpoint avulso             |
| `STRIPE_BILLING_WEBHOOK_SECRET`     | novo, do endpoint de billing         |
| `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` | `price_...` live                     |
| `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL`  | `price_...` live                     |
| `ABACATEPAY_API_KEY`                | chave de produção                    |
| `ABACATEPAY_WEBHOOK_SECRET`         | de produção                          |
| `ABACATEPAY_DEV_WEBHOOK_ENABLED`    | `false`                              |
| `GROWTH_PREMIUM_BILLING_ENABLED`    | `false` até o smoke de avulso passar |

As duas variáveis de price gold são load-bearing e estavam ausentes da versão
anterior deste spec. `GET /api/premium/pricing` devolve 503 sem elas, e a página
`/premium` do admin depende disso. Pior: em `me-premium.ts:184-191`, para o tier
**gold**, um `stripePriceId` vazio no catálogo cai silenciosamente no preço do
env. Deixadas com valores de test, um checkout live de gold seria montado com
preço de test.

Isso também corrige o que a versão anterior afirmava: campo vazio nem sempre dá 503. Para gold, não dá.

`RECONCILE_ALERT_DEPTH` tem default 200 e não é bloqueante, mas pertence à
tabela.

Nenhum valor `sk_` ou `whsec_` entra no repositório. Considerar chave restrita em
vez de `sk_live` de acesso total, dado que a conta é compartilhada com outro
negócio.

### 4. Catálogo no admin

Cadastrar cada `price_...` live em `/premium/catalogo`, casando tier e chave de
add-on. Verificar por `GET /api/plans`.

Para add-on, `stripePriceId` vazio devolve 503 com `missingAddonKeys` no corpo.
Para plano, a resposta é genérica e só o log da API diz tier, cadência e slug.
Para gold, ver a armadilha do fallback acima.

### 5. Observabilidade

`docs/observability.md:55-63` limita a regra de alerta a
`POST /stripe/webhook`. Estender para os três endpoints.

Definir e escrever o fluxo de reembolso pelo suporte, e o procedimento de
recuperação para "pagou e não recebeu" no caso de membership, que hoje não tem
endpoint equivalente ao `POST /admin/tickets/grant` dos ingressos.

Registrar a expectativa de resposta operacional. Fundador solo, alertas por
email, sem paging. Uma frase dizendo o que custa descobrir 14 horas depois.

## Ordem de execução

Corrigida em relação à versão anterior, que tinha um furo: com a flag desligada
o checkout devolve 503 e o webhook de billing descartava o evento, então o smoke
de assinatura era impossível na ordem proposta.

0. Fase 0 fechada e verificada.
1. Purgar linhas de test mode do banco (memberships, pedidos pendentes, refs de
   customer e subscription), e marcar ou arquivar pedidos pré-cutover.
2. Produtos e Prices na Stripe live, com descritor de conta definido.
3. `price_...` cadastrados no `/premium/catalogo` e verificados por
   `GET /api/plans`.
4. Variáveis no Railway, com `GROWTH_PREMIUM_BILLING_ENABLED=false`.
5. Smoke do avulso, cartão e Pix.
6. Flag para `true`.
7. Smoke da assinatura, imediatamente, antes de anunciar.

Invertendo 2 e 3, uma compra real pode chegar antes do catálogo existir. O
webhook responde 200, marca processado, alerta no Sentry e não cria a
membership. Dinheiro dentro, assinatura inexistente, recuperação manual, e o
membro não pode ser cobrado de novo.

Atenção ao passo 4: o avulso **não** é gateado por flag nenhuma. No instante em
que `sk_live_` entra no Railway, cartão e Pix estão valendo. Por isso o smoke de
avulso é o passo seguinte imediato, e não algo para a semana que vem.

## Verificação

Base: roteiro do
`docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-19-smoke-and-flag.md`,
em produção, valor real baixo, cartão do Pedro, refund ao final.

Um ciclo feliz por fluxo não basta. Todo defeito da Fase 0 vive fora do caminho
feliz. Casos adicionais obrigatórios, em ordem de dinheiro em risco:

1. Conferir a **versão de API** dos dois endpoints live contra a do endpoint de
   test, antes de qualquer cobrança.
2. Conferir o **descritor** na fatura real do smoke. Se aparecer nome pessoal,
   parar.
3. Refund de compra de carrinho, afirmando no banco que `Order.status` virou
   `refunded` e o ingresso virou `revoked`, não olhando o dashboard.
4. Pagar um pedido de carrinho depois da reserva expirar, afirmando refund ou
   alerta.
5. Assinar e cancelar pelo portal, afirmando `cancel_scheduled` e
   `cancelAtPeriodEnd` no banco.
6. Assinar e afirmar a linha de `PremiumMembership`, a de
   `PremiumMembershipInvoice` com o `devFeePercent` certo, e
   `SubscriptionWebhookEvent.processedAt` não nulo.
7. Reembolsar uma invoice de assinatura, afirmando `refunded` na linha.
8. Forçar uma renovação falha, afirmando `past_due`.
9. Trocar os dois secrets entre si por uma entrega, afirmando 400 nos dois
   endpoints e os alertas no Sentry. Prova que erro de colagem aparece em
   minutos, não em três dias.
10. Reentregar o mesmo id de evento, afirmando dedupe e exatamente um ingresso e
    uma invoice.
11. Abrir uma disputa na cobrança de smoke e afirmar o comportamento.

Evidência anexada antes de anunciar.

## Rollback

Ausente na versão anterior. O padrão do repo em `docs/migration-rollback-*.md`
cobre migração de banco, não go-live operacional, então este é novo.

Por passo: voltar as chaves para test, desabilitar os endpoints live no
dashboard, e desligar a flag. O que não volta atrás é dinheiro já recebido: os
pedidos pagos em voo precisam ser resolvidos um a um, com reembolso ou entrega
manual. Antes de qualquer rollback, listar pedidos `paid` e memberships criadas
na janela.

## Documentação

- `docs/stripe.md` reescrito para Casa Car Club: produtos, domínios, paths reais,
  a query string da AbacatePay, o descritor, e a versão de API dos endpoints. O
  conteúdo atual é da JDM e induz erro de operação. Ele também afirma que o
  Stripe Tax funciona porque o Checkout coleta endereço de cobrança, o que é
  falso: nenhum dos criadores de sessão seta `billing_address_collection` nem
  `automatic_tax`. Essa afirmação não pode sobreviver à reescrita.
- `docs/revenuecat.md` marcado como dormente.
- `docs/observability.md` estendido aos três endpoints.

## Questões abertas

**Stripe Tax.** Configuração atual foi desenhada para produto digital da JDM. O
CCC vende majoritariamente físico e presencial. Decisão do contador.

**Parcelamento.** `automatic_payment_methods` ligado e nenhum
`payment_method_options` significa parcelamento desligado. No Brasil, ticket de
cartão acima de uns R$200 sem parcelamento converte materialmente pior. Decidir
explicitamente e registrar a decisão.

**CPF no Pix.** `PixBillingCustomer.taxId` existe no tipo e nenhum chamador o
preenche. Ao mesmo tempo `legal.ts:60` promete que não coletamos CPF no Pix,
enquanto o CPF é coletado no perfil. Decidir se o Pix envia CPF e reconciliar a
frase da política nos dois casos. Isso conversa com a obrigação de nota fiscal.

**Reconciliação do Pix.** Não existe worker varrendo cobranças da AbacatePay
como o `billing-reconcile.ts` varre assinaturas Stripe. Um `transparent.completed`
perdido deixa Pix pago com pedido pendente até a varredura expirar, e a varredura
não reembolsa.
