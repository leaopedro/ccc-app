# Bloqueadores da submissão iOS — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover os bloqueadores que fazem a primeira submissão iOS ser rejeitada independente de pagamento.

**Architecture:** Quatro frentes independentes. A regra 1.2 (denúncia, bloqueio, EULA) é a única que exige modelo novo e toca API, mobile e admin. As outras três são configuração e conteúdo: strings de permissão, manifesto de privacidade, conta de demonstração e `eas.json`.

**Tech Stack:** Fastify, Prisma, Postgres, Expo/React Native, vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-08-12-ios-review-blockers-design.md`
**Rastreador:** `docs/superpowers/plans/2026-08-13-pagamentos-roadmap.md`

## Nota sobre o nível de detalhe

O plano da Fase 0 trazia cada passo com o código pronto. Aqui o detalhe está
concentrado onde a decisão é load-bearing: mudanças de schema, semântica de
deduplicação e auto-hide, e a direção da filtragem do bloqueio. Passos de
boilerplate (registrar rota, adicionar copy) estão nomeados sem transcrição.
Isso é escolha deliberada: o executor é a mesma sessão que levantou o terreno, e
transcrever CRUD de rota inflaria o documento sem reduzir risco.

## Global Constraints

- Rodar um arquivo: `cd apps/api && pnpm exec vitest run test/<caminho>`. Nunca `pnpm --filter @ccc/api test -- <arquivo>`: o `--` não filtra.
- Docker rodando. Worktree nova exige `pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build` antes de qualquer teste.
- Testes de integração da API contra Postgres real via Testcontainers.
- Copy voltada ao usuário em PT-BR. Código e comentários novos em inglês.
- Lint baseline: 72 warnings, 0 erros em `apps/api`. Não aumentar nenhum dos dois.
- Limiar de auto-hide: **3 denunciantes distintos**. Decidido em 2026-08-13.
- Credencial da conta de demonstração vem de env, nunca do repositório.

## O que já existe e não precisa ser criado

Levantado antes de planejar, e muda bastante o escopo:

- `Report` já tem `targetKind`, `postId`, `commentId`, `reporterUserId`, `reason`, `status` (`open|resolved|dismissed`), `resolverId`, `resolution`, `resolvedAt`. Falta só o endpoint de criação: nenhuma chamada `.create()` existe no repositório.
- `FeedPost.status` e `FeedComment.status` já são `visible|hidden|removed`, com `hiddenAt` e `hiddenById`. O auto-hide reusa isso, sem coluna nova.
- A fila de moderação no admin já lê e resolve `Report` (`routes/admin/feed-moderation.ts`).
- `FeedBan` existe, mas é aplicado pelo admin e tem escopo de evento. Não serve como bloqueio entre pessoas.

---

## Task 1: Denúncia de conteúdo

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (dois `@@unique` em `Report`)
- Create: `packages/db/prisma/migrations/<ts>_report_unique_per_reporter/migration.sql`
- Create: `packages/shared/src/reports.ts`
- Modify: `apps/api/src/routes/feed.ts`
- Create: `apps/api/src/services/feed/report.ts`
- Test: `apps/api/test/feed/report.test.ts`

**Interfaces:**

- Produces: `POST /events/:eventId/feed/:postId/report` e `POST /events/:eventId/feed/comments/:commentId/report`, corpo `{ reason: string }`, resposta 201 `{ reported: true, autoHidden: boolean }`.
- Produces: `AUTO_HIDE_REPORT_THRESHOLD = 3` exportado de `services/feed/report.ts`.

**Decisões load-bearing:**

Deduplicação por constraint, não por leitura antes da escrita:

```prisma
  @@unique([reporterUserId, postId])
  @@unique([reporterUserId, commentId])
```

Em Postgres, múltiplas linhas com NULL numa coluna do índice não colidem, então
uma denúncia de post (com `commentId` null) não conflita com outra de post do
mesmo autor, e os dois índices convivem. Denúncia repetida do mesmo alvo pelo
mesmo usuário levanta P2002, que a rota traduz para 200 idempotente, não 409:
denunciar duas vezes não é erro do usuário.

Auto-hide conta **denunciantes distintos com denúncia aberta**, não linhas. Ao
atingir 3, o alvo vira `status: hidden` com `hiddenAt: now()` e
`hiddenById: null`, e null aqui significa "escondido pelo sistema", distinguindo
de ação de moderador. Auto-hide nunca usa `removed`: remoção é decisão humana.

Denúncia é permitida em conteúdo já escondido, e não desconta nada. O contador
não desfaz o auto-hide se uma denúncia for descartada; reverter é ação de
moderador na fila do admin.

- [ ] **Step 1:** Teste que falha: denunciar cria linha, terceiro denunciante distinto esconde o post, mesmo usuário denunciando duas vezes é idempotente, denúncia em comentário esconde o comentário e não o post.
- [ ] **Step 2:** Rodar, confirmar vermelho.
- [ ] **Step 3:** Schema mais migration à mão (o setup dos testes roda `migrate deploy`).
- [ ] **Step 4:** `services/feed/report.ts` com a criação, o P2002 idempotente e o auto-hide numa transação.
- [ ] **Step 5:** Duas rotas em `feed.ts`, com rate limit no mesmo padrão das vizinhas.
- [ ] **Step 6:** Schema zod compartilhado.
- [ ] **Step 7:** Verde, typecheck, lint, commit.

---

## Task 2: Bloqueio entre usuários

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (modelo `UserBlock`)
- Create: migration
- Create: `apps/api/src/routes/me-blocks.ts`
- Modify: `apps/api/src/app.ts` (registro)
- Modify: `apps/api/src/services/feed/access.ts` ou o read do feed
- Test: `apps/api/test/feed/blocks.test.ts`

**Interfaces:**

- Produces: `PUT /api/me/blocks/:userId`, `DELETE /api/me/blocks/:userId`, `GET /api/me/blocks`.
- Produces: helper `blockedUserIdsFor(userId): Promise<string[]>` que devolve os ids nas **duas** direções.

**Decisões load-bearing:**

```prisma
model UserBlock {
  id        String   @id @default(cuid())
  blockerId String
  blockedId String
  createdAt DateTime @default(now())

  blocker User @relation("UserBlockBlocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked User @relation("UserBlockBlocked", fields: [blockedId], references: [id], onDelete: Cascade)

  @@unique([blockerId, blockedId])
  @@index([blockedId])
}
```

A filtragem é **simétrica**: quem eu bloqueei não aparece para mim, e eu não
apareço para quem me bloqueou. Assimétrico deixaria o bloqueado continuar
comentando no post de quem o bloqueou, que é exatamente o assédio que a 1.2
quer cortar. O índice em `blockedId` existe por causa da segunda direção.

Bloquear a si mesmo é 422. Bloquear duas vezes é idempotente, por isso `PUT` e
não `POST`.

Escopo declarado: a filtragem cobre a leitura do feed, posts e comentários. Não
cobre presença em lista de participantes de evento nem check-in, que são fatos
operacionais e não conteúdo social.

- [ ] **Step 1:** Teste que falha, cobrindo as duas direções e o autobloqueio.
- [ ] **Step 2:** Vermelho.
- [ ] **Step 3:** Schema, migration, rotas, helper, filtragem no read.
- [ ] **Step 4:** Verde, typecheck, lint, commit.

---

## Task 3: UI de denúncia e bloqueio no mobile

**Files:**

- Modify: as telas de feed em `apps/mobile/src/screens/` (post e comentário)
- Modify: `apps/mobile/src/copy/feed.ts`
- Create: cliente de API para as rotas novas
- Test: vitest de componente

**Decisões:** sheet de ações no post e no comentário, com Denunciar e Bloquear
autor. Denunciar pede motivo em campo livre. Bloquear confirma antes, porque
esconde conteúdo do usuário. Sem denúncia anônima ao autor: o autor nunca é
avisado de quem denunciou.

O revisor precisa **alcançar** os dois. Ficar atrás de long-press sem affordance
visível é motivo de rejeição, então o gatilho é um botão de reticências visível.

- [ ] **Step 1:** Copy PT-BR.
- [ ] **Step 2:** Sheet, chamadas, estados de erro.
- [ ] **Step 3:** Teste de componente, verde, commit.

---

## Task 4: Termos de uso com aceite versionado

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (`User.termsVersion`, `User.termsAcceptedAt`)
- Create: migration
- Create: `packages/shared/src/terms.ts` (conteúdo mais `TERMS_VERSION`)
- Create: rota de termos no mobile, espelhando `app/(auth)/privacidade.tsx`
- Modify: `apps/mobile/app/(auth)/signup.tsx` (o link morto)
- Modify: `apps/api/src/routes/auth/*` (gravar versão no signup)
- Create: página pública no admin, espelhando `(public)/privacidade`
- Test: API mais componente

**Decisões:** o texto foi escrito aqui e passou por revisão jurídica antes de
publicar, confirmada pelo fundador em 2026-08-14. Cobre assinatura, ingresso de evento e
loja, mais o prazo de arrependimento de sete dias do CDC. A política de reembolso
entra no mesmo documento, com seção própria, porque link separado dobra
manutenção sem ganho.

Gravar `termsVersion` no aceite é o que torna auditável qual texto a pessoa
aceitou. Sem isso o checkbox é decorativo, que é o estado atual.

- [ ] **Step 1:** Rascunho do texto.
- [ ] **Step 2:** Schema, migration, shared.
- [ ] **Step 3:** Rota mobile, link do signup vivo, gravação no signup.
- [ ] **Step 4:** Página pública no admin.
- [ ] **Step 5:** Testes, verde, commit.

---

## Task 5: Strings de permissão e manifesto de privacidade

**Files:**

- Modify: `apps/mobile/app.config.ts` (options dos plugins)
- Modify: `apps/mobile/ios/*/PrivacyInfo.xcprivacy`

**Decisões:** suprimir câmera, microfone e Face ID via options dos plugins, em vez
de editar o `Info.plist` gerado, que é regenerado pelo prebuild. Se algum plugin
não aceitar supressão, aí sim entra copy PT-BR verdadeira.

O manifesto declara o que o app realmente coleta: email, telefone, CPF, fotos,
documento de identidade e histórico de compras.

- [ ] **Step 1:** Options, rodar prebuild, confirmar que as três strings sumiram do plist gerado.
- [ ] **Step 2:** Manifesto.
- [ ] **Step 3:** Commit.

---

## Task 6: Conta de demonstração

**Files:**

- Create: `apps/api/src/scripts/seed-review-account.ts`
- Test: `apps/api/test/scripts/seed-review-account.test.ts`

**Decisões:** email e senha vêm de `REVIEW_ACCOUNT_EMAIL` e
`REVIEW_ACCOUNT_PASSWORD`, nunca do repositório. O script cria a conta já
verificada, com assinatura ativa e um evento futuro com ingresso disponível, e é
idempotente para poder rodar de novo antes de cada submissão.

Sem isso o revisor esbarra no muro de verificação de email
(`app/_layout.tsx:84-93`) e rejeita por não conseguir entrar.

- [ ] **Step 1:** Teste que falha.
- [ ] **Step 2:** Script idempotente.
- [ ] **Step 3:** Verde, commit.

---

## Task 7: Configuração de build

**Files:**

- Modify: `apps/mobile/eas.json`
- Modify: `docs/eas-credentials.md`

**Decisões:** o perfil `production` recebe `pk_live`, o domínio próprio da API,
`EXPO_PUBLIC_CAIXA_ENABLED=true` e `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`. A chave
live é valor do Pedro; entra como pendência explícita se ele ainda não a tiver.
`docs/eas-credentials.md` ainda diz `com.jdmexperience.app`.

- [ ] **Step 1:** Editar, commit.

---

## Task 8: Aposentar o SKU da vaga de garagem adicional

**Files:**

- Modify: `packages/db/src/garage-spot-product.ts`
- Modify: `packages/db/prisma/seed.ts`
- Modify: `apps/mobile/src/screens/garage/garage-slots.ts` e a tela que renderiza o tile
- Test: ajustar `apps/api/test/cart/garage-checkout.test.ts` e `virtual-guards.test.ts`

**Decisões:** decidido em 2026-08-13 remover de todo lugar, não só do iOS. É
desbloqueio digital sem defesa pela 3.1.5(a), e hoje é inalcançável porque
`defaultFreeGarageSpots` nunca foi configurado.

Remover o produto do seed e o tile da UI. O modelo `GarageSpot` e o caminho de
fulfillment **ficam**: vaga concedida por plano premium continua sendo um
conceito válido, e `GarageSpotSource.premium_membership` está no enum para isso.
Só a venda avulsa sai.

- [ ] **Step 1:** Remover do seed e do produto.
- [ ] **Step 2:** Remover o tile.
- [ ] **Step 3:** Ajustar os testes que compram a vaga.
- [ ] **Step 4:** Verde, commit.

---

## Ordem

Tasks 1, 2 e 3 são a regra 1.2 e vão primeiro, na ordem, porque a 3 consome as
duas anteriores. Task 4 é a segunda maior e independente. Tasks 5, 7 e 8 são
curtas e independentes. Task 6 fecha, porque a conta de demonstração precisa da
assinatura funcionando.

## Pendências que dependem do Pedro

- Valor de `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` live e o domínio da API.
- `REVIEW_ACCOUNT_EMAIL` e `REVIEW_ACCOUNT_PASSWORD`.
- Revisão dos textos legais.
- Decisão item por item sobre benefício anunciado e não implementado (regra 2.3.1), que está no rastreador.
