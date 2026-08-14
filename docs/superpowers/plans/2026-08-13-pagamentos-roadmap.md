# Pagamentos — rastreador único

**Criado:** 2026-08-13
**Por que existe:** os quatro specs cobrem tudo, mas cada um cobre uma fatia. Não
havia lista ordenada com dono por item, e vários itens não são de engenharia.

Legenda de dono: **DEV** = codificável, **PEDRO** = decisão, painel ou jurídico.

Specs: [Fase 0](../specs/2026-08-12-billing-fixes-design.md) ·
[Spec A](../specs/2026-08-12-stripe-live-web-design.md) ·
[Bloqueadores iOS](../specs/2026-08-12-ios-review-blockers-design.md) ·
[Apple Pay](../specs/2026-08-12-apple-pay-ios-design.md)

---

## Fase 0 — correções de billing

Implementada. PR [#21](https://github.com/leaopedro/ccc-app/pull/21). Suíte
completa verde: 262 arquivos, 2268 testes.

- [ ] **PEDRO** Revisar e mergear o PR #21. Primeira revisão devolveu cinco
      achados, todos válidos: quatro defeitos de código e um artefato de diff por
      branch atrasada. Corrigidos em `ee3f8e8` e no merge `c5729dc`, com resposta
      no PR. O mais grave era que evento guardado nunca recuperava, o que
      invalidava três afirmações minhas na documentação.
- [ ] **PEDRO** Setar `ANTHROPIC_API_KEY` nos secrets do repo. O check
      `claude-review` falha em 30s em todo PR porque a variável chega vazia. Não
      é problema de código.

---

## Spec A — go-live da web

### Bloqueadores jurídicos, antes da primeira cobrança real

- [ ] **PEDRO** Migrar a conta Stripe para o CNPJ **antes de produção**. Decidido
      em 2026-08-14. Isso resolve a divergência de merchant of record: quem recebe
      passa a ser a mesma entidade que os documentos legais nomeiam
      (LIONS HUB ENGENHARIA DE SOFTWARE LTDA, 40.142.944/0001-18) e a nota fiscal
      sai por quem recebeu.

      **Consequências que mudam o Spec A**, porque trocar de conta é mais amplo que
      trocar de modo:

      - Chaves, secrets de webhook e endpoints são todos novos.
      - **Todo `price_...` muda**, então o catálogo em `/premium/catalogo` é
        recadastrado do zero e as duas variáveis de preço gold no Railway também.
      - **Todo `cus_`, `sub_` e `pi_` guardado no banco fica inválido**, não só os
        de test mode. É exatamente o caso `resource_missing` que virou 409
        `StaleBillingReference`, e é o que o script de purga limpa. O
        discriminador por instante de corte continua correto, e passa a cobrir
        mais linhas do que cobriria numa simples virada test → live.
      - O descritor de fatura `CASA CAR CLUB` precisa ser configurado na conta
        nova.

      **Risco que aumenta, e é o que mais importa.** O Spec A manda ler a versão de
      API do endpoint de test existente e fixar os endpoints live na mesma. Numa
      conta **nova** não existe endpoint antigo para copiar: os endpoints nascem na
      versão corrente da Stripe, que é mais nova que a `2026-04-22.dahlia` que o
      normalizador lê. Ou seja, o descasamento de forma de invoice deixa de ser
      possibilidade e vira o caso provável. Fixe explicitamente a versão de cada
      endpoint novo em `2026-04-22.dahlia` na criação. A sentinela
      `UNRECOGNIZED_SHAPE` existe como rede, não como substituto: ela responde 503
      e alerta, e o evento só aplica depois que a versão for corrigida.

- [x] **PEDRO** Preencher a identificação da entidade nos documentos legais. Feito
      em 2026-08-14 com os dados da política publicada.
- [ ] **PEDRO** Alinhar o rótulo de versão da política no site. O conteúdo lá já
      tem a correção de CPF, mas o rótulo ainda diz `privacy-2026-08-06`, enquanto
      o repositório vai para `privacy-2026-08-14`.
- [x] **DEV** Termos de uso e política de reembolso publicados, com o prazo de
      arrependimento de sete dias. Vivem em `packages/shared/src/terms.ts`, com
      aceite versionado em `User.termsVersion`.
- [ ] **PEDRO** Decidir nota fiscal: emitir desde a primeira venda via
      integração, ou aceitar a exposição com dono e prazo datados. Zero
      ocorrências no repositório hoje. Stripe Tax é cálculo, não emissão.
- [ ] **PEDRO** Stripe Tax: levar ao contador. A configuração herdada era de
      produto digital (SaaS) e o CCC vende físico e presencial.
- [ ] **PEDRO** Parcelamento no cartão: hoje está desligado, sem
      `payment_method_options`. No Brasil, ticket acima de uns R$200 sem
      parcelamento converte pior. Decidir e registrar.
- [x] **PEDRO** CPF: decidido em 2026-08-14 que a política é que estava errada. O
      CPF é coletado no perfil, criptografado, e usado no gate de assinatura; o
      manifesto de privacidade do iOS estava certo. A frase foi reescrita e a
      versão subiu para `privacy-2026-08-14`. **Correção:** eu afirmei antes que
      nada lê essa constante, e estava errado — meu grep não cobriu o `apps/admin`.
      O `cookie-banner.tsx` compara a versão guardada com ela, então o bump faz o
      banner de cookies reaparecer para quem usa o admin. Mobile e API não leem.
- [ ] **PEDRO** Decidir, com apoio jurídico, se a correção da política exige novo
      consentimento dos usuários existentes.
- [ ] **PEDRO** CPF no Pix: o campo `taxId` existe no tipo e nenhum chamador o
      preenche. Decidir se o Pix passa a enviar CPF, o que conversa com a
      obrigação de nota fiscal.

### Código

- [ ] **DEV** Adicionar AbacatePay ao fanout de exclusão de conta
      (`services/account-deletion/vendor-fanout.ts`). É Operador nomeado na
      política e está ausente.
- [ ] **DEV** Atualizar `legal.ts`: assinatura deixa de ser "gerida pela
      RevenueCat" e passa a Stripe, na prosa e na tabela de subprocessadores.
      Subir `PRIVACY_POLICY_VERSION`.
- [ ] **PEDRO** Decidir se a mudança de subprocessador exige novo consentimento.
- [ ] **DEV** Alinhar a data de vigência da política: `legal.ts` diz 6 de agosto
      de 2026, `apps/admin/app/(public)/privacidade/page.tsx` diz 14 de maio.
- [ ] **DEV** Marcar ou arquivar pedidos pré-cutover. Não existe campo
      `livemode`, e `routes/admin/finance.ts` agrega tudo junto, então o primeiro
      relatório de receita real incluiria dinheiro de teste.
- [ ] **DEV** Caminho de recuperação de membership. Ingresso tem
      `POST /admin/tickets/grant`; assinatura não tem equivalente. Hoje o
      procedimento é manual e está escrito no Runbook 5 de
      `docs/observability.md`.
- [ ] **DEV** Worker de reconciliação do Pix. Não existe nada varrendo cobranças
      da AbacatePay como o `billing-reconcile.ts` varre assinaturas Stripe. Um
      `transparent.completed` perdido deixa Pix pago com pedido pendente.

### Painel e ops, na ordem

1. [ ] **PEDRO** Ler a versão de API do endpoint de webhook de test e criar todo
       endpoint live fixado na mesma. **Gate de tudo.** Motivo em `docs/stripe.md` §0.
2. [ ] **PEDRO** Rodar a purga em dry run contra um dump e conferir as contagens
       à mão antes de rodar valendo. Falso positivo revoga entitlement de quem
       paga. O comando exige o instante da virada, sem default:
       `tsx src/scripts/purge-test-mode.ts --created-before=<ISO> --dry-run`.
       O discriminador é tempo, não o id: id de test mode de Customer,
       Subscription e PaymentIntent é igual ao live.
3. [ ] **PEDRO** Criar produtos e preços live, com `devFeePercent` em todo Price
       de plano e `baseAmountCents` igual ao `unit_amount`.
4. [ ] **PEDRO** Definir o descritor de fatura da conta como `CASA CAR CLUB`.
5. [ ] **PEDRO** Habilitar o portal de billing, cancelamento ao fim do período.
6. [ ] **PEDRO** Registrar os três webhooks com os caminhos exatos, incluindo
       `?webhookSecret=` na AbacatePay, e os dois eventos de disputa novos.
7. [ ] **PEDRO** Cadastrar os `price_...` em `/premium/catalogo` e verificar com
       `GET /api/plans`.
8. [ ] **PEDRO** Setar as variáveis no Railway, com
       `GROWTH_PREMIUM_BILLING_ENABLED=false`. Não esquecer
       `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` e `_ANNUAL`: para gold, catálogo vazio
       cai silenciosamente no preço do env, e valor de test sob chave live monta
       checkout com preço de test.
9. [ ] **PEDRO** Configurar as regras de alerta do Sentry, incluindo as cinco
       novas descritas em `docs/observability.md`.
10. [ ] **PEDRO** Smoke do avulso, cartão e Pix. O avulso não tem flag: no
        instante em que `sk_live_` entra, está valendo.
11. [ ] **PEDRO** Virar a flag para `true`.
12. [ ] **PEDRO** Smoke da assinatura, imediatamente, antes de anunciar. Os onze
        casos obrigatórios estão no Spec A.

---

## Bloqueadores da primeira submissão iOS

Estimativa de rejeição só por estes itens: 75 a 90 por cento. Nada aqui depende
do Spec A.

### Regra 1.2 — conteúdo gerado por usuário

- [ ] **DEV** Denúncia de conteúdo pelo usuário. O modelo `Report` existe e
      nenhuma chamada `.create()` existe no repositório: a tabela é vazia por
      construção.
- [ ] **DEV** Bloquear usuário. `FeedBan` é aplicado pelo admin e tem escopo de
      evento; não existe bloqueio entre pessoas.
- [ ] **DEV** Documento de termos, rota, aceite versionado no `User`, e o link do
      signup navegando. Hoje "Termos" é `<Text>` puro sem `onPress`.

### Regras 5.1.1 e 5.1.2

- [ ] **DEV** Suprimir ou traduzir as strings de câmera, microfone e Face ID.
      Vêm por autolink e o app não tem nenhuma das três funcionalidades.
- [ ] **DEV** Preencher `NSPrivacyCollectedDataTypes` no
      `PrivacyInfo.xcprivacy`, hoje array vazio, enquanto o app coleta email,
      telefone, CPF, fotos e documento de identidade.

### Regra 2.1

- [ ] **DEV** Seed de conta de demonstração com email já verificado, assinatura
      ativa e evento com ingresso. Revisor que se cadastra sozinho trava no muro
      de verificação de email.
- [ ] **PEDRO** Publicar privacidade e termos em URL HTTPS pública em
      `casacar.club`. App Store Connect exige.
- [ ] **DEV** Garantir que nenhuma aba primária caia em placeholder "em breve" no
      build submetido.

### Regra 2.3.1 — benefício anunciado e não implementado

- [x] **DEV** Removidos da folha do Premium em 2026-08-14, decisão do Pedro:
      "Garagem em destaque" e "Página pública premium", nas versões PT e EN.
      Nenhum dos dois existe no código. Reintroduzir só junto da implementação.
- [ ] **PEDRO** Os demais seguem abertos, e são benefícios de plano no seed, não
      copy do app: contador de convidados, desconto de parceiro, verificação de
      membership na porta, e `GarageSpotSource.premium_membership`, que está no
      enum e nunca é usado.

### Configuração de build

- [ ] **DEV** `eas.json` perfil `production`: chave `pk_live`, domínio próprio em
      vez de `ccc-app-production.up.railway.app`, `EXPO_PUBLIC_CAIXA_ENABLED` e
      `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`.
- [ ] **DEV** `docs/eas-credentials.md` ainda diz `com.jdmexperience.app`.
- [x] **DEV** Remover o SKU virtual "Vaga de Garagem Adicional". Decidido em
      2026-08-13: sai de todo lugar.

---

## Apple Pay no iOS

### Reposicionamento do produto, antes do código

- [x] **PEDRO** Valor da caixa por tier, informado em 2026-08-14 e declarado
      aproximado: bronze R$ 49,90, silver R$ 109,90, gold R$ 249,90. Semeado para
      dev e preview em `packages/db/prisma/seed.ts`, só no `create`, para uma
      reexecução não sobrescrever ajuste feito no admin.
- [ ] **PEDRO** Setar os mesmos valores em produção, em `/premium/catalogo`. O
      campo já existe no formulário do admin, então muda sem deploy — que é o
      certo para número que o próprio Pedro classificou como aproximado.
- [ ] **PEDRO** Nome do fornecedor e valor de repasse por módulo de add-on, para
      `vendorName` e `payoutAmountCents`. **Pergunta aberta em 2026-08-14:** a
      resposta dada foi "Mercado Livre majoritariamente", mas esse campo não
      descreve compra de produto: os dois módulos são `detailing` (3 acessos/mês
      de lavagem) e `oficina` (5 horas/mês), que são serviços presenciais
      executados por alguém. Falta saber **quem executa**. Se a resposta sobre
      Mercado Livre era sobre onde os itens da caixa são comprados, isso é
      procurement e não entra aqui.
- [ ] **DEV** Reescrever a folha "O que é Premium?" (`src/copy/garage.ts:99-106`
      e a versão em inglês em `:210-219`) para liderar com box, clube e serviços.
      Hoje os quatro benefícios listados são digitais, e é essa folha que o
      revisor lê.

### Credenciais Apple

- [ ] **PEDRO** Habilitar `merchant.com.casacarclub.app` nos App IDs `.dev` e
      `.preview` no portal da Apple, e regerar os provisioning profiles no EAS.
      Sem isso não dá para testar Apple Pay fora de build de loja.

### Código

- [ ] **DEV** `flow: native` no `POST /api/cart/checkout`, com `receipt_email` e
      cancelamento da PaymentIntent quando a varredura expirar o pedido.
- [ ] **DEV** Endpoint de assinatura nativa, lendo
      `latest_invoice.confirmation_secret.client_secret`.
- [ ] **DEV** Guarda de duplicidade por índice único parcial no banco, com UUID
      por tentativa como chave de idempotência. A chave por pacote que o spec
      original propunha replica a assinatura antiga numa recontratação dentro de
      24 horas.
- [ ] **DEV** Gate por plataforma servido pela API, com teste. A flag atual é
      global: desligar para responder à Apple mataria web e Android junto.
- [ ] **DEV** Remover o isolamento iOS: gate do `StripeProvider`, regra de lint
      `no-stripe-on-ios`, teste de isolamento, e marcar o canon §F8.16 como
      superseded em vez de apagar.
- [ ] **DEV** `merchantIdentifier` preenchido em todas as variants.
- [ ] **DEV** `PaymentSheet` no carrinho, na assinatura e no retomar pedido, com
      `returnURL` para o retorno do 3DS.

### Submissão

- [ ] **PEDRO** Teste manual de Apple Pay em aparelho físico com cartão real na
      carteira, contra a Stripe em test mode. Não roda em simulador nem em CI.
- [ ] **PEDRO** Notas de review descrevendo o que o membro recebe fisicamente.
      Recomendação: curtas, sem citar número de regra.
- [ ] **PEDRO** Submeter.

---

## Fora de escopo, registrado de propósito

- Webhook da RevenueCat tem o mesmo padrão de descarte que a Fase 0 corrigiu no
  de billing. Mantido porque a RevenueCat está dormente.
- Reembolso parcial continua ignorado. Hoje funciona por acidente, porque
  carrinho gera um único `Order`, então o refund parcial acaba sendo integral.
  Confirmar antes do go-live.
- Google Pay no Android sai quase de graça junto do `PaymentSheet`, mas não foi
  pedido.
- Remover a RevenueCat do repositório fica para depois da primeira aprovação.
