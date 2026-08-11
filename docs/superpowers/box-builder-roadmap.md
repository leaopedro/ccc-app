# Box Builder — roadmap e handoff

Documento vivo para qualquer agente continuar o Box Builder. Curto e direto.

## O que e o Box Builder

Membros Premium ganham um budget mensal em R$ por plano. O organizador
monta um catalogo curado, modulos de parceiros e as regras da caixa. O
assinante escolhe itens dentro do budget a cada ciclo. Modulos de parceiros
sao cobrados a parte.

Docs de origem:

- Spec: `docs/superpowers/specs/2026-08-09-box-builder-design.md`
- Plano Fase 1: `docs/superpowers/plans/2026-08-09-box-builder-fase-1.md`
- Design: `docs/design/box-builder/`

## Estado por fase

### Fase 1 — Config (CONCLUIDA)

Config-only. Sem runtime de ciclo. Entregue em `feat/box-builder-design` (PR #9).

Escopo entregue:

- Schema Prisma: `BoxCatalogItem`, `Partner`, `PartnerModule`, `BoxSettings`.
- `PremiumPlan.monthlyBoxBudgetCents` (budget mensal por plano).
- Migration aditiva (nao destrutiva).
- Schemas Zod em `packages/shared/src/admin-box.ts`.
- API admin CRUD: catalogo, parceiros/modulos, settings (scope organizer/admin).
- Upload de imagens R2: kinds `box_item`, `partner_logo`, `partner_module`.
- Admin web: paginas `/box/catalogo`, `/box/parceiros`, `/box/config` + subnav.
- Seed idempotente de `BoxSettings`.

Correcoes pos-review (mesmo PR):

- CRC32 no presign resolvido via merge do `main` (PR #8).
- `BoxSettings` agora e singleton por id fixo (`box_default`) com upsert.
- Admin mostra imagem atual (`imageUrl`/`logoUrl` vindos da API).
- Validacao de chave por prefixo de kind (`isKindKey`) nas rotas de box.
- Nav expoe Catalogo, Parceiros e Configuracao.

### Fase 2 — Runtime de ciclo (CONCLUIDA)

API do atendente + logica de ciclo/cutoff/worker. Entregue em
`feat/box-builder-fase-2` (PR #11, mergeado em `main`).

Escopo entregue:

- Schema Prisma de runtime: `MonthlyBox`, `MonthlyBoxItem`,
  `MonthlyBoxPartnerItem`, `BoxCatalogItemCycleStock`. `OrderKind.box` adicionado.
- Hook de abertura: `MonthlyBox` aberto automaticamente no forward-advance da
  assinatura Premium (swallows P2002; um box por ciclo por assinatura). Roda
  pos-commit nos tres caminhos: webhook Stripe, webhook RevenueCat, worker de
  reconciliacao.
- API do atendente: `GET /me/box`, `PUT /me/box/selection`, `POST /me/box/confirm`.
- Ledger de estoque por ciclo: reserva atomica em `BoxCatalogItemCycleStock`
  com decremento transacional.
- Worker de cutoff (`runBoxCutoffTick`): skip/ready, trim LIFO de excesso,
  cancela Order pendente sem sobrepor pagamento liquidado.

Serializacao das tres rotas que mutam a caixa (confirm, PUT selection, worker)
via lock `FOR UPDATE` na linha da `Garage` (mesmo recurso nas tres). Confirm e
PUT relockam e re-checam `status` + `cutoffAt` dentro da transacao.

Correcoes pos-review (PR #11):

- `box` adicionado ao `orderKindSchema` do shared e ao label mobile
  (`GET /me/orders` deixaria de 500 num Order de box).
- Cutoff nao envia caixa com frete nao pago: `shippingCents > 0` vira `skipped`,
  nunca `ready`.
- Cutoff distingue `paid` de outros estados nao-pendentes do Order (cancelado
  por outra via libera estoque e resolve, em vez de travar).
- `maxPerCycle` aplicado no PUT (422).

Nota: Fase 4 ainda e dona de: checkout do provider + flip do webhook para pago

- fulfillment e refund no admin. `settlePaidOrder` hoje lanca de proposito para
  `kind === 'box'`, como guarda ate a Fase 4 implementar a liquidacao.

### Fase 3 — UI mobile (PENDENTE)

Tela do assinante montar a caixa dentro do budget.

Dependencia do worker de cutoff (ja implementado, aguardando consumidor): a
branch de auto-send do worker espera uma caixa `open` com `autoSendOptIn = true`
e `shippingAddressId` setados enquanto a caixa segue aberta. Nenhum endpoint da
Fase 2 seta esses campos com a caixa aberta por design. A Fase 3 mobile precisa
persistir opt-in de auto-send + endereco na caixa aberta (novo campo no PUT ou
endpoint dedicado) para tornar esse caminho alcancavel.

### Fase 4 — Checkout dos extras (PENDENTE)

Checkout dos modulos de parceiro + webhook + fulfillment no admin. Manter a
invariante: pedido so vira `paid` por webhook verificado, nunca por chamada
do cliente. Webhooks idempotentes por event id.

### Fase 5 — Notificacoes (PENDENTE)

Expo Push nos marcos do ciclo.

## Integracao com o PR de assinaturas (PR #5)

- PR #9 (box) e PR #5 (assinaturas) sao ramos paralelos de `main`.
- Sem dependencia dura. Backbone Premium ja esta em `main`.
- Banco integra limpo: schemas auto-merge, migrations independentes.
- Conflitos mecanicos esperados no segundo a mergear:
  `admin/index.ts`, `admin-api.ts`, `authed-nav.tsx`, `middleware.ts`,
  `premium-catalog-client.tsx` (este ultimo exige cuidado: reencaixar o
  campo `monthlyBoxBudgetCents` no form final).
- Ordem sugerida: mergear #9 primeiro (limpo com `main`), depois #5 resolve
  `main` + overlap de uma vez.

## Follow-ups adiados (nao bloqueiam merge)

Fase 1:

- API mantem union `UploadKind` paralela ao `UPLOAD_KINDS` do shared. Derivar.
- `packages/shared/src/index.ts` tem `export * from './cart.js'` duplicado.
- Sem guarda de MIME no servidor no presign (R2 valida via content-type assinado).
- CEP editor e textarea (from:to por linha), nao UI de linhas.

Fase 2 (do review do PR #11):

- Persistir auto-send + endereco na caixa aberta e trabalho da Fase 3 (ver
  dependencia acima). O caminho de auto-send do worker fica inalcancavel ate la.
- Cancelar Order de box pelo endpoint generico de cancelamento nao libera o
  estoque do ciclo na hora. O cutoff resolve depois (libera + resolve), mas a
  caixa segue `awaiting_payment` ate o cutoff. Aceitavel na Fase 2.

## Onde esta o ledger de execucao

- Fase 1: `.superpowers/sdd/2026-08-09-box-builder-fase-1/progress.md`
- Fase 2: `.superpowers/sdd/2026-08-10-box-builder-fase-2/progress.md`

Ambos git-ignored (scratch). Registram cada task, reviews e decisoes.
