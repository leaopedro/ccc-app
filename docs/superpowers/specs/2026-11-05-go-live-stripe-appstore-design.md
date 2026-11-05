# Go-live — Stripe na conta do CNPJ e primeira submissão à App Store

**Data:** 2026-11-05
**Status:** rascunho, aguardando aprovação
**Substitui na prática:** a parte de execução de `2026-08-12-stripe-live-web-design.md` (Spec A)
**Fora de escopo:** `2026-09-13-android-play-deploy-design.md`

## Por que este documento existe

O produto está pronto e não recebe dinheiro. Produção inteira roda na conta
Stripe sandbox, e o binário iOS só existe em TestFlight. São dois cortes
distintos, com modos de falha distintos, e a tentação é tratá-los como um só.

Este documento separa os dois, fixa a ordem entre eles, e registra o que já
está pronto para não ser reconstruído.

## Objetivo

1. `app.casacar.club` e a API passam a cobrar de verdade, na conta do CNPJ.
2. O app iOS entra em App Review pela primeira vez, carregando a chave live.

## Metas

- Primeira cobrança real em cartão, Pix e assinatura, nas três superfícies.
- Build de produção iOS que **não** depende de `ALLOW_TEST_STRIPE_KEY`.
- Submissão aceita para review, com conta de demonstração funcionando.

## Não-metas

- Android / Google Play. Tem spec próprio e sai depois.
- Apple Pay nativo. O certificado existe e continua dormente.
- Stripe Tax e nota fiscal. Continuam pendência jurídica aberta.
- Qualquer refatoração de billing. A Fase 0 já fechou.

## Anti-metas

O que torna isto um fracasso mesmo tendo "funcionado":

- Um binário aprovado pela Apple cobrando numa conta que a API não lê. É o
  pior resultado possível: o membro paga, a Stripe confirma, e o webhook cai
  numa conta sem endpoint. O pedido nunca vira `paid`.
- Linhas apontando para objetos test-mode sobrevivendo ao corte. O efeito é
  silencioso: `providerSubRef` de teste faz o sweep de reconciliação lançar,
  o catch por linha engole, e a assinatura **nunca expira**. O membro fica com
  premium vitalício sem assinatura viva atrás.
- Receita de teste contada como receita real no admin.
- Rodar os scripts de corte com instantes `--created-before` diferentes entre
  si. Os dois cortes deixam de concordar sobre o que é real.

## Estado atual, verificado em 2026-11-05

Verificado contra o repositório nesta sessão, não por memória.

**Bloqueadores de App Review da spec de agosto: feitos.** `prisma.report.create`
existe em `apps/api/src/services/feed/report.ts:45`. O modelo `UserBlock` existe
em `packages/db/prisma/schema.prisma:1789`. `apps/mobile/app/(auth)/termos.tsx` e
`packages/shared/src/terms.ts` existem. O CNPJ `40.142.944/0001-18` está
preenchido em `legal.ts:44` e `terms.ts:26`, sem placeholder. Política de
reembolso e arrependimento estão no texto. As strings fantasma de câmera,
microfone e FaceID sumiram do `app.config.ts`; sobraram as duas de biblioteca de
fotos, que são verdadeiras.

**Ferramental de corte: já construído.** Três scripts em `apps/api/src/scripts/`:

- `purge-test-mode.ts` — quarentena das linhas que referenciam objetos
  test-mode. Exige `--created-before=<ISO>`, sem default, e aceita `--dry-run`.
  Discrimina por tempo e não por id, de propósito: ids test-mode de Customer,
  Subscription e PaymentIntent são indistinguíveis dos live.
- `mark-pre-cutover-orders.ts` — mesma interface. Preenche `Order.livemode` e
  `PremiumMembershipInvoice.livemode`, que a migração `20260831205831` criou com
  default `true` justamente para não sumir receita sozinha.
- `seed-review-account.ts` — provisiona a conta que o revisor usa, já com
  `emailVerifiedAt`, assinatura ativa e evento reservável. Idempotente. Lê
  `REVIEW_ACCOUNT_EMAIL` e `REVIEW_ACCOUNT_PASSWORD` do ambiente.

Nenhum dos três tem entrada em `apps/api/package.json`. Rodam direto.

**O bloqueador real.** `apps/mobile/eas.json` carrega
`pk_test_51U4ESaBl1stGgSds…` nos perfis `preview` e `production`. É a conta
sandbox. `app.config.ts:56` lança em build de produção com `pk_test_`, a menos
que `ALLOW_TEST_STRIPE_KEY=1` esteja setado, que é exatamente o que o perfil
`testflight` faz. Hoje, por construção, só dá para publicar TestFlight.

**O que a troca de chave realmente toca.** Não é uma linha:

| Onde       | Variável                                           | Hoje                                |
| ---------- | -------------------------------------------------- | ----------------------------------- |
| Railway    | `STRIPE_SECRET_KEY`                                | `sk_test_` da sandbox               |
| Railway    | `STRIPE_WEBHOOK_SECRET`                            | sandbox, `/stripe/webhook`          |
| Railway    | `STRIPE_BILLING_WEBHOOK_SECRET`                    | sandbox, `/webhooks/stripe-billing` |
| Railway    | `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` / `_ANNUAL`    | ausentes                            |
| Railway    | `ABACATEPAY_API_KEY` / `ABACATEPAY_WEBHOOK_SECRET` | test                                |
| Banco      | `PremiumPlanPrice.stripePriceId` (3 linhas)        | prices da sandbox                   |
| Banco      | `PremiumAddonModule.stripePriceId` (3 linhas)      | prices da sandbox                   |
| `eas.json` | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`               | `pk_test_` em dois perfis           |

O catálogo **não está no repositório**. Vive no banco. Os produtos e prices
live já existem na conta do CNPJ (ver abaixo), então o trabalho aqui é só
repontar as linhas, não recriar catálogo.

`STRIPE_WEBHOOK_SECRET` é obrigatório no schema (`env.ts:28`);
`STRIPE_BILLING_WEBHOOK_SECRET` é opcional (`env.ts:96`). A API sobe sem o
segundo e as assinaturas falham caladas. Setar os dois.

Enquanto `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` e `_ANNUAL` estiverem ausentes,
`GET /api/premium/pricing` responde 503 (`premium-pricing.ts:61`).

**O admin não troca nada.** Varrido nesta sessão: `apps/admin/src` lê só
`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SENTRY_DSN` e `NODE_ENV`. Nenhuma
chave Stripe. Tudo que ele faz com pagamento passa pela API. Então no corte o
admin é **superfície de verificação**, não item de migração: é onde se confere
que a receita live aparece e que o estorno funciona contra a conta nova.

**Flags do Railway que o corte depende, e que não são chaves.** Conferir todas
antes de cobrar de verdade, porque cada uma falha calada:

- `WORKER_ENABLED` e `BROADCAST_WORKER_ENABLED` têm default `'false'`
  (`env.ts:54,58`). Sem elas a API não registra cron nenhum, e as duas varreduras
  de reconciliação de billing e Pix nunca rodam. Foram setadas em 2026-09-13;
  confirmar que continuam lá.
- `GROWTH_PREMIUM_BILLING_ENABLED` tem default `'true'` no código, mas o
  comentário em `env.ts:70` manda mantê-la `false` no Railway até o smoke da
  F8.19 passar. Resolver essa contradição antes do corte, não durante.
- `DEV_FEE_PERCENT` tem default `10` (`env.ts:67`), mas no catálogo live isso
  não morde: os três prices de plano já trazem `devFeePercent=0`. Não
  reescrever esse metadado.
- `PREMIUM_SUBSCRIPTIONS_IOS` (`env.ts:84`) desliga o ponto de entrada de
  assinatura só no iOS, sem tocar web nem renovação. É a saída limpa se a
  Apple questionar a assinatura fora de IAP.

**A conta live está pronta, verificado em 2026-11-05.**
`acct_1U4ESTBnUVVOBICw`, `business_type: company`,
`LIONS HUB ENGENHARIA DE SOFTWARE LTDA`, `charges_enabled: true`,
`payouts_enabled: true`, `card_payments` e `boleto_payments` ativos, moeda
`brl`, descritor `CASA CAR CLUB`.

Isso fecha o bloqueador jurídico de merchant of record que a Spec A de agosto
levantou. Lá a conta era pessoa física e os documentos nomeavam um CNPJ que não
recebia. Hoje a razão social da conta Stripe bate exatamente com
`packages/shared/src/legal.ts:43` e com `terms.ts`. Não há mais divergência.

**O catálogo live já existe e está correto.** Quatro produtos, criados em
2026-08-17: `Ingresso`, `Estrada`, `Fundador` e `Detailing`. São exatamente os
três planos de `packages/db/prisma/seed.ts:601` mais o único add-on ativo.
`Oficina` está ausente, o que é certo: o seed a marca `active: false` de
propósito, porque não há serviço de oficina sendo prestado e `me-premium.ts`
aceitaria a chave num checkout direto.

Os nomes dos planos **não** são bronze/silver/gold. Esses são os valores de
`tier` no banco. Os nomes são Ingresso 4990, Estrada 10990, Fundador 24990.

**Os prices live existem, com os valores certos e o metadado certo.**
Verificado em 2026-11-05:

| price id (live)                  | valor       | metadados                                         |
| -------------------------------- | ----------- | ------------------------------------------------- |
| `price_1U5UfiBnUVVOBICwKJVyo7fr` | 4990 /mês   | `tier=bronze`, `devFeePercent=0`                  |
| `price_1U5UfiBnUVVOBICw7kX23JDE` | 10990 /mês  | `tier=silver`, `devFeePercent=0`                  |
| `price_1U5UfjBnUVVOBICwgzWHUfnS` | 24990 /mês  | `tier=gold`, `cadence=monthly`, `devFeePercent=0` |
| `price_1U5UfjBnUVVOBICwS6oBJJSJ` | 249900 /ano | `tier=gold`, `cadence=annual`, `devFeePercent=0`  |
| `price_1U5UfjBnUVVOBICw1Ho2Mh3V` | 7490 /mês   | `addonKey=detailing`                              |

Os dois últimos ids de gold são exatamente o que
`STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` e `_ANNUAL` precisam receber.

O price de add-on **não** carrega `devFeePercent`, e isso está certo:
`stripe-billing-webhook.ts:189-192` lê o split só da linha de plano, nunca do
add-on. E quando não consegue resolver, `:576` responde 503 para forçar
retry em vez de gravar um zero inventado. O risco de voltar ao default `10`
de `DEV_FEE_PERCENT` não existe neste catálogo.

**Os endpoints de webhook live estavam faltando, e foram criados em
2026-11-05.** A lista vinha vazia, que era exatamente a anti-meta número um:
chave secreta live no Railway e nenhum endpoint registrado significa membro
pagando e pedido que nunca vira `paid`.

| endpoint                                           | id                            | eventos |
| -------------------------------------------------- | ----------------------------- | ------- |
| `https://api.casacar.club/stripe/webhook`          | `we_1UYSn5BnUVVOBICw3NZTbION` | 7       |
| `https://api.casacar.club/webhooks/stripe-billing` | `we_1UYSngBnUVVOBICwmsp9S6XG` | 5       |

Os dois `enabled`, os dois com `api_version=2026-04-22.dahlia`, batendo com
`services/stripe/index.ts:423`.

Criar pela API e não pelo dashboard foi deliberado: o dashboard carimba o
endpoint com a API version padrão da conta, e se ela divergir do que o
normalizador parseia, `stripe-billing-webhook.ts:444` responde 503 para sempre
sobre um cartão já cobrado.

A chave `rk_live_` do CLI não tinha `webhook_write`; a permissão foi concedida
por Pedro para esta criação.

## Decisões

**A ordem é Stripe primeiro, soak, depois submissão.** Decidido por Pedro. A
razão é a anti-meta número um: se o binário for aprovado antes da API estar
live, o que foi aprovado cobra numa conta errada. Rodadas de rejeição também
deixam de bloquear receita.

**Não há membros reais na sandbox.** Confirmado por Pedro: só ele e testers.
Isso torna `purge-test-mode` um corte limpo, sem passo de comunicação nem
caminho de re-assinatura. É a premissa que mais simplifica este plano, e se
ela estiver errada o plano muda.

**`devFeePercent` continua `0`** nos metadados dos preços live, espelhando a
decisão de 2026-08-26. `stripe-billing-webhook.ts` lê o split só desse
metadado, então replicar o catálogo sem ele mudaria o comportamento em
silêncio.

**O perfil `testflight` morre no fim.** Ele só existe para contornar o guard do
`app.config.ts`. Com a chave live no `production`, manter o bypass é manter
uma forma de construir, sem querer, exatamente a anti-meta número um.

## Fase 1 — Stripe live

Um instante `T` de corte é escolhido e **anotado** antes de qualquer coisa.
Os dois scripts recebem o mesmo `T`.

Conta, produtos e prices já estão verificados e corretos, então não há passo
de criação de catálogo. O trabalho começa no webhook.

1. ~~Registrar os dois endpoints live.~~ **Feito em 2026-11-05**, ids e
   eventos na seção de estado acima. Os dois signing secrets saíram na
   resposta de criação e entram no Railway no passo 3.

2. AbacatePay em live: chave e segredo de webhook. Confirmar que
   `ABACATEPAY_DEV_WEBHOOK_ENABLED` está ausente ou `false`.
3. Trocar as variáveis do Railway numa janela só, e redeployar.
4. Conferir as flags no mesmo deploy: workers ligados, a contradição do
   `GROWTH_PREMIUM_BILLING_ENABLED` resolvida, e
   `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY=price_1U5UfjBnUVVOBICwgzWHUfnS`,
   `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL=price_1U5UfjBnUVVOBICwS6oBJJSJ`.
5. Provar que o segredo trocado é o mesmo que a Stripe assina. Não existe
   `stripe trigger` em live, então o teste é assinar um payload sintético com
   o signing secret do endpoint e postar na rota. `400 invalid signature`
   significa que a API ainda está noutro segredo; `200` ou `503` significam
   assinatura verificada. Rodado em 2026-11-05 antes da troca, nos dois
   endpoints, e os dois deram 400, que era o resultado esperado e serve de
   controle. Repetir depois do deploy esperando sair do 400.
6. Repontar as linhas de `stripePriceId` para os ids live da tabela acima:
   três em `PremiumPlanPrice` mensais, mais a anual de gold se estiver
   cadastrada, mais `detailing` em `PremiumAddonModule`.
7. `mark-pre-cutover-orders --created-before=T --dry-run`, conferir as
   contagens, depois pra valer.
8. `purge-test-mode --created-before=T --dry-run`, conferir, depois pra valer.

Ordem de 7 e 8 importa pouco entre si, mas as duas vêm **depois** da troca de
chave: antes disso não existe corte para marcar.

## Fase 2 — Soak

Uma cobrança real de cada tipo, em `app.casacar.club`: cartão no carrinho, Pix
avulso, e uma assinatura. Cada uma verificada até o fim, não só no checkout:
o pedido vira `paid` por webhook, o split registrado é zero, e o admin mostra
a receita como live.

Duração a combinar. O ponto do soak é que uma rejeição da Apple não trave
dinheiro entrando.

## Fase 3 — Submissão

1. `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` vira `pk_live_` em `production` e
   `preview` no `eas.json`.
2. Remover o perfil de build `testflight` e seu `ALLOW_TEST_STRIPE_KEY`.
3. Rodar `seed-review-account.ts` contra produção.
4. Metadados no App Store Connect: respostas de App Privacy, URL de suporte,
   URL de política hospedada, screenshots, conta de demonstração nas notas.
5. Build e submit com `--profile production`. Nunca `eas submit --latest`
   pelado: ele resolve credenciais contra o bundle id `.dev`.
6. Não repetir um submit "para conferir". A Apple registra a segunda subida
   como Failed na mesma versão. Ler a URL que o comando imprime.

## Riscos aceitos

Primeira submissão nunca revisada. Mesmo com os bloqueadores de agosto
fechados, orçar pelo menos uma rodada de rejeição.

A assinatura premium cobra por Stripe e não por IAP. A defesa é a 3.1.3(e), e
ela só vale porque a caixa física viaja no binário:
`EXPO_PUBLIC_CAIXA_ENABLED` está `"true"` nos três perfis, verificado. Se
alguém desligar essa flag antes de submeter, a defesa cai e vira 3.1.1.

A `rk_live_` do CLI expira em 2026-11-24.

## Rollback

Fase 1 é reversível trocando as variáveis do Railway de volta e repontando as
seis linhas. Os dois scripts têm rollback documentado em
`docs/migration-rollback-order-livemode.md`; o de `livemode` é um `UPDATE`
simples. As contagens de cada dry-run precisam estar anotadas, junto do `T`,
ou reconstruir o corte exige adivinhar o instante.

## O que fica para quem implementar

- O instante `T` exato e a duração do soak.
- Como as linhas de `stripePriceId` são repontadas: admin ou SQL.
- Texto e screenshots do App Store Connect.
- Se a anual de gold entra na UI. O price live existe
  (`price_1U5UfjBnUVVOBICwS6oBJJSJ`), mas o registro de agosto diz que a
  interface não a oferece.
