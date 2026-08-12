# Box Builder — Fase 3 (UI mobile) — design

Data: 2026-08-11. Fonte de regras: `2026-08-09-box-builder-design.md`.
Referencia de UI: `docs/design/box-builder/README.md` (15 telas alta fidelidade).

Entrega a tela do assinante montar a caixa do ciclo dentro do budget, mais a
camada de leitura/skip/historico/preferencias que essas telas exigem. Pagamento
e fulfillment timeline ficam pra Fase 4.

Este design passou por review de tres agentes independentes. As resolucoes dos
achados estao embutidas abaixo; a matriz de review vive no historico da sessao.

## Escopo

Dentro: telas 01 (+ variante skipped), 02, 03, 04, 05, 08 (read-only, CTA de
pagamento desabilitado com "disponivel em breve"), 09-minimal, 10, 11, 12, 13,
14, 15.

Fora (Fase 4): telas 06 (metodo) e 07 (Pix), timeline de fulfillment.

Extras na Fase 3 (decisao do dono): "confirma e estaciona". O usuario pode
confirmar com charge > 0. A caixa vai pra `awaiting_payment` read-only. Sem
pagamento ate o cutoff, o worker corta pro budget-only (perde extras). Consistente
com o seam da Fase 4.

## API do atendente (`/me`, elegibilidade = membership active/trialing)

### GET /me/box/catalog

Catalogo navegavel do ciclo corrente, combinado (telas 02 + 04):

- `categories: string[]` — valores distintos de `BoxCatalogItem.category`
  (campo `String @db.VarChar(60)`; nao existe modelo de categoria).
- `items: [{ id, title, category, imageUrl, priceCents, maxPerCycle|null,
soldOut: boolean }]` — expoe `soldOut`, nao a contagem de estoque (Q5: so
  "sem estoque" no zero). `soldOut` deriva de `BoxCatalogItemCycleStock` com
  fallback: quando nao existe linha no ledger pro ciclo, usa `stockPerCycle`
  como total; `null` = ilimitado. A leitura e fora de transacao; a corrida e
  aceita no servidor e `soldOut` e apenas indicativo (a reserva atomica no
  confirm/cutoff e a fonte real).
- `partners: [{ id, name, logoUrl, description,
modules: [{ id, name, description, imageUrl, priceCents }] }]`.
- So itens ativos (nao arquivados). Item arquivado que ja esta na selecao
  aparece pela box view (R11), nao por aqui.
- `imageUrl`/`logoUrl` via o helper de URL publica de `services/uploads/r2.ts`
  (mesmo que `routes/admin/box-catalog-admin.ts` usa).

### POST /me/box/skip e POST /me/box/unskip

- `skip`: `open` -> `skipped`. `unskip`: `skipped` -> `open` enquanto
  `cutoffAt` no futuro (tela 11, spec Q8).
- Ambos dentro de `prisma.$transaction` com lock da linha da `Garage`
  (`SELECT id FROM "Garage" WHERE id = ... FOR UPDATE`) e re-checagem de status
  pos-lock, igual confirm/PUT selection. Sem o lock, o worker de cutoff pode
  travar a caixa entre a leitura e o update.
- Skip preserva a selecao. Skip/unskip so valem pra `open`/`skipped`;
  `awaiting_payment` e terminal ate cutoff ou pagamento (Fase 4).

### GET /me/boxes

Historico. Escopo por `garageId`, so autenticado (NAO gated por membership
ativa), pra membro que lapsou ou reassinou ainda ver caixas passadas.

Retorna `[{ id, cycleKey, cycleStart, status, chargeCents, thumbnails[],
current: boolean }]`, mais recente primeiro, sem paginacao no MVP.

### PUT /me/box/preferences

`{ autoSendOptIn, shippingAddressId? }` na caixa `open`. Lock da `Garage`,
valida posse do endereco, rejeita status != open com 409. Nao muda status.

E o UNICO caminho de escrita de `autoSendOptIn` (removido do corpo do confirm).
Confirm continua dono de `shippingAddressId` (recomputa `shippingCents`).
Persiste o opt-in + endereco na caixa aberta, tornando alcancavel a branch de
auto-confirm do worker no cutoff.

### Box view (enriquecimento do GET /me/box)

- Adiciona `imageUrl` em `boxViewItemSchema` e `boxViewPartnerItemSchema`.
  Fonte: join via `BOX_INCLUDE` pra `catalogItem`/`partnerModule` +
  helper r2 (a imagem nao e snapshotada nas tabelas de linha).
- Adiciona `included` e `dropReason` (e `droppedAt`) nas linhas, pra tela 10
  renderizar os itens removidos no fechamento com o motivo (R2b).
- `chargeCents` da view enquanto `open` nao inclui frete (frete so e computado no
  confirm). O cliente nao mostra frete na tela de builder.

## Nav mobile

Substitui a aba Ingressos por um slot premium-gated; Ingressos vira item de lista
no Perfil (sempre).

- Loja ON (5 abas): Eventos | Loja | Carrinho | [Caixa/Assinatura] | Perfil
- Loja OFF (4 abas): Eventos | Carrinho | [Caixa/Assinatura] | Perfil
- Slot premium: `active === true` -> Caixa; senao -> Assinatura. O schema
  `mySubscriptionResponse` nao tem `trialing`; o gate e `active` (trialing mapeia
  pra `active: true` no backend).

Implementacao:

- Todas as abas registradas sempre; visibilidade via o padrao `href: null` ja
  usado no `_layout.tsx` (nao trocar ramos por ternario, que arrisca remount e
  perda de estado com dois condicionais no mesmo `<Tabs>`).
- Anti-flicker: semear o estado premium de um flag last-known em AsyncStorage;
  neutro ate resolver. Sem isso a aba pisca Assinatura -> Caixa em todo cold
  start de membro.
- Mantem as rotas `/tickets`, `/store`, `/assinaturas` registradas. Corrige o
  redirect de `store/_layout.tsx` que aponta pra `/tickets`. `/tickets`
  acessivel pelo item do Perfil; deep links de push/checkout ainda resolvem, com
  ancora de volta pro Perfil.

## Arquitetura mobile

- Estado: selecao local otimista + PUT debounced da selecao inteira
  (`PUT /me/box/selection` substitui tudo, last-write-wins R14). Flush no
  blur/unmount da tela (nao cancela). Totais do servidor sao a verdade; cliente
  computa otimista do `unitPriceCents` (linhas existentes usam o snapshot da
  view; itens novos usam `priceCents` do catalogo) so pra animar a barra.
- Offline (decisao do dono): persist local minimo. Salva a selecao corrente em
  AsyncStorage e reenvia ao reconectar. Sem fila completa. Erro de escrita ->
  toast + retry; erro de carga -> tela de retry.
- Deteccao premium: hook `usePremiumSubscription` (`active`).
- 09-minimal: renderiza "Caixa confirmada" pra todo `fulfillmentStatus` nao
  `unfulfilled` (ja existem caixas `ready` de producao). Timeline na Fase 4.
- Arquivos: `app/(app)/caixa/*` (rotas), `src/screens/caixa/*`, `src/api/box.ts`,
  hooks `useBox`/`useBoxCatalog`/`useBoxHistory`. Nav em `app/(app)/_layout.tsx` +
  `src/navigation/app-tabs.ts`. Reusa `@ccc/design` + `src/theme` e a API de
  endereco existente (`src/api/store.ts`). Shared: estende
  `packages/shared/src/box.ts` (catalog, history, preferences, imageUrl).

## Comportamentos do design a nao esquecer

- Variante skipped da tela 01 ("Voce pulou agosto" + link voltar).
- Confirm com selecao vazia: bloqueado na UI.
- `cancelled`: sem tela propria; exibe como skipped, gap documentado.
- Banner de excedente uma vez por sessao; mapa de haptics
  (selection/warning/success); countdown com modo urgente nas ultimas 24h;
  `prefers-reduced-motion` respeitado. Todos ja no design doc.

## Testes

- API (Vitest + Testcontainers, Postgres real): catalogo (elegibilidade,
  exclusao de arquivados, math de soldOut); skip/unskip (lock, cutoff, status);
  preferences (posse de endereco, 409 fora de open); historico (escopo garage);
  view (linhas removidas + imageUrl); gate de opt-in no cutoff (o worker ja
  aplica em `box-cutoff.ts`; falta o teste).
- Mobile: unidades puras (resolucao de abas premium/free x loja on/off; totais
  otimistas; transicoes skip/unskip) + testes de interacao no padrao existente.

## Residuais assumidos

- `soldOut` tem corrida de leitura (aceita; a reserva atomica e a verdade).
- Beco de `awaiting_payment` ate a Fase 4 e intencional (CTA desabilitado).
- Persist local minimo nao e fila completa; conflito resolve por last-write-wins
  no reenvio.
