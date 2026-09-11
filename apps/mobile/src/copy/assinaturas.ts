// PT-BR copy for the Assinaturas module (planos, detalhe, minha assinatura).
// EN scaffold kept minimal per the i18n mandate (CLAUDE.md cross-cutting).

// Shared between `alterar.blockedPastDueBody` (pre-check block, subscription
// already past_due when the screen loads) and `alterar.errorPastDue` (the
// same fact surfacing mid-action, from a 409 InvalidStatus race) — one
// sentence, not two variants of the same state.
const ALTERAR_PAST_DUE_BODY =
  'Sua assinatura está com um pagamento pendente. Resolva a cobrança antes de trocar de plano.';

export const assinaturasCopy = {
  header: {
    title: 'ASSINATURA',
    back: 'Voltar',
  },
  intro: {
    eyebrow: 'ESCOLHA SEU NÍVEL',
    heading: ['Torne-se membro', 'da Casa'],
    subcopy: 'Selecione o plano que combina com o seu jeito de dirigir, conectar e pertencer.',
  },
  plans: {
    perMonth: 'POR MÊS',
    // CTA label is "ASSINAR {TIER}" — tier appended by the screen.
    ctaPrefix: 'ASSINAR',
  },
  modules: {
    eyebrow: 'MÓDULOS ADICIONAIS',
    subcopy: 'Serviços extras opcionais que você pode adicionar à sua assinatura, agora ou depois.',
    perMonth: '/MÊS',
    footnote: 'Você poderá adicionar módulos durante a contratação ou depois, em Minha Assinatura.',
  },
  // Loading / error / empty shared across the planos + detalhe screens.
  states: {
    loading: 'Carregando planos...',
    errorTitle: 'Não foi possível carregar os planos.',
    errorRetry: 'Tentar novamente',
    empty: 'Nenhum plano disponível no momento.',
  },
  detail: {
    back: 'Voltar',
    header: 'PLANO',
    perMonth: 'POR MÊS',
    benefitsTitle: 'O QUE ESTÁ INCLUÍDO',
    cta: 'ASSINAR',
    notFound: 'Plano não encontrado.',
  },
  // Shared between ContratarScreen and PlanoDetalheScreen — not owned by
  // either, so it lives at the top level rather than under `contratar`.
  //
  // Decisão 6 — the physical side of the membership, stated before purchase.
  // The per-plan contents come from the DB benefit labels (registered by hand
  // in /premium/catalogo, prerequisite H3); this block is the framing that
  // makes them read as a physical delivery rather than an app feature.
  //
  // Fix round 1 (Criticals 1+2): the box is opt-in per cycle, curated and
  // confirmed by the member before a cutoff (`box-cutoff.ts`) — not something
  // that simply arrives. A box with no confirmation, no items, or no
  // auto-send address is skipped entirely (`box-cutoff.ts:137-143`), so this
  // copy must not promise automatic delivery. Freight is also never
  // mentioned: only one seeded region ships free (`seed.ts:694`), everywhere
  // else pays `shippingFeeCents`, and an unpaid-shipping box outside that
  // region is skipped rather than sent (`box-cutoff.ts:28-31`) — any single
  // blanket claim about freight is false somewhere, so the paywall makes none.
  caixa: {
    title: 'A CAIXA CASA CAR CLUB',
    body: 'Todo ciclo, você monta sua caixa com curadoria da Casa e confirma antes do fechamento.',
    delivery: 'Uma caixa por ciclo mensal, mediante sua confirmação.',
  },
  contratar: {
    header: 'CONTRATAR',
    back: 'Voltar',
    planLabel: 'PLANO ESCOLHIDO',
    modulesTitle: 'MÓDULOS ADICIONAIS',
    modulesSubcopy: 'Opcionais. Você pode adicionar ou remover depois.',
    add: 'ADICIONAR',
    remove: 'REMOVER',
    quotaAccess: (n: number) => `${n} acessos por mês`,
    quotaHours: (n: number) => `${n} horas por mês`,
    summaryBase: 'Mensalidade base',
    summaryModules: 'Módulos',
    summaryTotal: 'Total por mês',
    cta: 'IR PARA O PAGAMENTO',
    ctaLoading: 'PROCESSANDO...',
    confirming: 'Confirmando pagamento...',
    pendingTitle: 'Pagamento em processamento.',
    pendingSubcopy: 'Assim que o pagamento for confirmado sua assinatura aparece aqui.',
    pendingCta: 'VER MINHA ASSINATURA',
    // Final review I4: this used to reuse paymentsCopy.sheet.cancelled, which
    // says "Seu pedido continua aguardando pagamento". There is no *pedido* in
    // the subscription flow — the member closed the sheet on a contratação,
    // and the pending attempt (not an order) is what stays open. Closing the
    // sheet is a choice, so this is a plain toast, never an error.
    cancelledToast: 'Pagamento cancelado. Sua assinatura não foi ativada.',
    errorGeneric: 'Não foi possível iniciar o pagamento. Tente novamente.',
    // One string per actionable failure. Telling a member to "tente novamente"
    // when the answer is "you already subscribe" or "wait a minute" sends them
    // into a retry loop that cannot succeed.
    errorUnavailable: 'A contratação está indisponível agora. Tente mais tarde.',
    errorAddon: 'Um dos módulos escolhidos está indisponível. Remova ele e tente de novo.',
    errorAlreadySubscribed: 'Você já tem uma assinatura ativa.',
    errorAlreadySubscribedCta: 'GERENCIAR ASSINATURA',
    errorStaleBilling: 'Seu cadastro de pagamento não é mais válido. Fale com a gente.',
    errorIncompleteProfile: 'Complete seu perfil antes de assinar.',
    errorRateLimited: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
    errorPlanNotFound: 'Esse plano não está mais disponível.',
    errorUnauthorized: 'Sua sessão expirou. Entre de novo para continuar.',
    // Reachable only when the member switches to a DIFFERENT package after a
    // decline: the previous attempt is still locked (up to the reaper's TTL —
    // billing-reconcile.ts) and cannot be reused for a new package digest.
    // Same-package retries reuse the pending attempt instead of hitting this
    // 409 at all (final review I2) — "wait an instant" is false here, since
    // the lock can outlive far more than an instant. There is no in-app way
    // to cancel the pending attempt, so the honest advice is to retry the
    // same plan (which reuses it) or wait for it to clear on its own.
    errorAttemptInFlight:
      'Você tem uma tentativa de assinatura de outro plano em andamento. Tente novamente com o mesmo plano de antes, ou aguarde essa tentativa expirar.',
  },
  // Plan-change confirmation screen (troca de plano dentro de Minha
  // Assinatura). Same rateio mechanism as contratar's add-on attach/detach
  // (tasks 9 e 10), so `whenBody` is the ONE canonical phrasing — those
  // screens reuse this key rather than writing their own sentence.
  alterar: {
    // Names the spec fixes verbatim (design doc, seção 4) — the feature is
    // "alterar assinatura", not "trocar de plano", and Task 7 builds the
    // screen against these exact strings.
    header: 'ALTERAR ASSINATURA',
    back: 'Voltar',
    // `DE`/`PARA` label two side-by-side cards (current plan vs target
    // plan), not section titles — kept terse on purpose.
    fromLabel: 'DE',
    toLabel: 'PARA',
    // `baseAmountCents` is the snapshot of the CONTRACTED cadence, not always
    // monthly — an annual snapshot labelled "mensalidade" would be off by a
    // factor of twelve. Functions of cadence, not fixed strings.
    currentValue: (cadence: 'monthly' | 'annual') =>
      cadence === 'annual' ? 'Valor anual de hoje' : 'Valor mensal de hoje',
    newValue: (cadence: 'monthly' | 'annual') =>
      cadence === 'annual' ? 'Novo valor anual' : 'Novo valor mensal',
    valueTitle: 'O QUE MUDA NO VALOR',
    gainTitle: 'O QUE VOCÊ GANHA',
    loseTitle: 'O QUE VOCÊ PERDE',
    // Lists add-ons that stay attached (status === 'active') with their
    // monthlyDeltaCents — not "what stays the same" in general.
    keptTitle: 'SEUS MÓDULOS CONTINUAM',
    whenTitle: 'QUANDO VALE',
    // Global Constraint — literal, single formulation. contratar's future
    // add-on attach/detach copy (tasks 9/10) reads this key instead of
    // writing a variant.
    whenBody:
      'A mudança vale assim que você confirmar. Nada é cobrado agora: a diferença proporcional entra na sua próxima fatura, que pode ser a que fecha neste ciclo.',
    cta: 'CONFIRMAR ALTERAÇÃO',
    ctaLoading: 'CONFIRMANDO...',
    voltar: 'VOLTAR',
    confirming: 'Confirmando a troca de plano...',
    pendingTitle: 'Troca em processamento.',
    pendingSubcopy: 'Assim que a troca for confirmada seu plano aparece atualizado aqui.',
    pendingCta: 'VER MINHA ASSINATURA',
    successToast: 'Plano alterado.',
    // Blocked state when the membership is Apple/RevenueCat: no Stripe
    // subscription to change here, so the screen points at the App Store
    // instead of offering a CTA that would 409.
    appleTitle: 'Assinatura pela App Store',
    appleBody: 'Esta assinatura foi contratada pela App Store. A troca de plano é feita por lá.',
    appleCta: 'ABRIR APP STORE',
    // Blocked state for InvalidStatus (subscription status outside
    // ['active', 'cancel_scheduled']) — past_due is the reachable case today.
    blockedPastDueTitle: 'Pagamento pendente',
    blockedPastDueBody: ALTERAR_PAST_DUE_BODY,
    blockedPastDueCta: 'VER COBRANÇA',
    // 422 ANNUAL_CADENCE_ADDON_UNSUPPORTED — a combination error, not an
    // availability one: annual cadence does not accept the monthly-only
    // add-ons already attached.
    unavailableCadence:
      'O plano anual não aceita os módulos adicionais da sua assinatura. Remova os módulos antes de trocar para o anual.',
    // Informational note when the membership already has a scheduled
    // cancellation (cancel_scheduled is allowed by the guard, but the member
    // should know changing plans does not clear the cancellation).
    cancelScheduledNote:
      'Sua assinatura tem um cancelamento agendado. Trocar de plano não desfaz esse cancelamento.',
    errorGeneric: 'Não foi possível trocar de plano. Tente novamente.',
    errorUnavailable: 'A troca de plano está indisponível agora. Tente mais tarde.',
    errorPastDue: ALTERAR_PAST_DUE_BODY,
    errorNoChange: 'Você já está nesse plano.',
    errorPlanNotFound: 'Esse plano não está mais disponível.',
    // Distinct from errorPlanNotFound: this is the 404 for "no live
    // membership at all" (route's plain `NotFound`), not "plan not found".
    // The plan is still there — there is no subscription to change it on.
    errorNoMembership: 'Você não tem uma assinatura ativa para alterar.',
    errorRateLimited: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
    errorUnauthorized: 'Sua sessão expirou. Entre de novo para continuar.',
  },
  // Post-purchase welcome. Reached only after the poll confirmed the
  // membership exists, so this copy may state the activation as a fact — it
  // is never shown on the pending path (`contratar.pendingTitle` owns that).
  //
  // The benefit list is NOT here: it comes from the subscription payload
  // (DB-registered labels), the same source Minha Assinatura reads. Only the
  // framing lives in copy, so the two screens can never disagree about what
  // the member bought.
  boasVindas: {
    eyebrow: 'ASSINATURA ATIVA',
    title: 'Bem-vindo à Casa',
    subcopy:
      'Seu pagamento foi confirmado. A partir de agora você é membro, com acesso aos encontros, à garagem e à curadoria da Casa.',
    planLabel: 'SEU PLANO',
    benefitsTitle: 'O QUE JÁ É SEU',
    nextTitle: 'POR ONDE COMEÇAR',
    // Each step points at something the member can do today. The caixa step
    // follows the same build flag as the caixa block in `contratar` — a step
    // linking to a screen that is not in the build is worse than no step.
    steps: {
      caixaTitle: 'Monte sua caixa',
      caixaBody: 'Escolha os itens da curadoria deste ciclo e confirme antes do fechamento.',
      eventosTitle: 'Reserve seu lugar',
      eventosBody: 'Veja os próximos encontros e garanta sua vaga antes de lotar.',
      garagemTitle: 'Apresente seu carro',
      garagemBody: 'Cadastre seu carro na garagem e seja reconhecido nos encontros.',
    },
    cta: 'VER MINHA ASSINATURA',
    loading: 'Preparando suas boas-vindas...',
  },
  minhaAssinatura: {
    header: 'MINHA ASSINATURA',
    back: 'Voltar',
    loading: 'Carregando sua assinatura...',
    errorTitle: 'Não foi possível carregar sua assinatura.',
    errorRetry: 'Tentar novamente',
    planLabel: 'SEU PLANO',
    baseLabel: 'Mensalidade base',
    addonsLabel: 'Módulos adicionais',
    totalLabel: 'Total por mês',
    addonsTitle: 'MÓDULOS',
    usageLabel: 'Uso no ciclo',
    usageAccess: (used: number, total: number) => `${used} de ${total} acessos usados`,
    usageHours: (used: number, total: number) => `${used} de ${total} horas usadas`,
    usageRemainingAccess: (remaining: number) => `${remaining} restantes`,
    usageRemainingHours: (remaining: number) => `${remaining}h restantes`,
    usageNoCycle: 'Sem ciclo aberto.',
    addonStatusCancelScheduled: 'Cancelamento agendado',
    renewsAt: (date: string) => `Renova em ${date}`,
    cancelsAt: (date: string) => `Cancela em ${date}`,
    // No active membership.
    emptyTitle: 'Você ainda não é assinante.',
    emptySubcopy: 'Escolha um plano e faça parte da Casa.',
    emptyCta: 'VER PLANOS',
    // Billing switched off (flag / 503) — the screen cannot tell which. Not
    // "coming soon": the feature exists and "em breve" reads as it having
    // been withdrawn to a member who already pays. But the flag-off case is
    // a deliberate pre-launch rollout gate (see apps/api/src/env.ts), not a
    // malfunction, and its resolution is a multi-step smoke-test signoff,
    // not minutes — so this copy must not assert a cause ("manutenção") or a
    // timeline ("minutos") that only holds for the 503 case. State only.
    unavailableTitle: 'Assinaturas indisponíveis no momento.',
    unavailableSubcopy: 'Tente novamente mais tarde.',
    benefitsTitle: 'O QUE ESTÁ INCLUÍDO',
    seeAllPlans: 'VER TODOS OS PLANOS',
    historico: {
      title: 'HISTÓRICO DE COBRANÇAS',
      empty: 'Nenhuma cobrança ainda.',
      error: 'Não foi possível carregar o histórico.',
      refunded: 'Estornado',
      paidAt: (date: string) => `Pago em ${date}`,
    },
    cancelar: {
      trigger: 'Cancelar assinatura',
      sheetTitle: 'Cancelar assinatura',
      body: (date: string) =>
        `Sua assinatura continua ativa até ${date}. Depois dessa data você perde os benefícios e os módulos contratados.`,
      keep: 'MANTER ASSINATURA',
      confirm: 'CANCELAR ASSINATURA',
      loading: 'CANCELANDO...',
      successToast: 'Cancelamento agendado.',
      error: 'Não foi possível cancelar. Tente novamente.',
      appleTitle: 'Assinatura pela App Store',
      appleBody: 'Esta assinatura foi contratada pela App Store. O cancelamento é feito por lá.',
      appleCta: 'ABRIR APP STORE',
    },
  },
} as const;

/**
 * EN scaffold. This file was PT-only until 2026-08-29; only the keys added from
 * that date on carry an EN twin, so the eventual move to a shared locale package
 * is mechanical instead of a rewrite.
 */
// Shared between `alterar.blockedPastDueBody` and `alterar.errorPastDue` in
// the EN twin, same reason as the PT constant above.
const ALTERAR_PAST_DUE_BODY_EN =
  'Your subscription has a pending payment. Settle the charge before changing plans.';

export const assinaturasCopyEn = {
  // Mirrors the top-level `caixa` key in `assinaturasCopy` — keep both in
  // sync (fix round 1, Criticals 1+2: opt-in/curated per cycle, no freight
  // claim; see the comment on `assinaturasCopy.caixa` for why).
  caixa: {
    title: 'THE CASA CAR CLUB BOX',
    body: 'Every cycle, you curate your box and confirm it before the cutoff.',
    delivery: 'One box per monthly cycle, on your confirmation.',
  },
  // Fix round 2 — the twins this file's own rule required and did not have.
  // `errorAttemptInFlight` was added on this branch and `cancelledToast` in
  // this round; see their PT comments for the reachability each one describes.
  contratar: {
    cancelledToast: 'Payment cancelled. Your membership was not activated.',
    errorAttemptInFlight:
      'You have a subscription attempt for another plan in progress. Try again with the same plan as before, or wait for that attempt to expire.',
  },
  // Brand-new block, so every key carries a twin from day one.
  alterar: {
    header: 'CHANGE MEMBERSHIP',
    back: 'Back',
    fromLabel: 'FROM',
    toLabel: 'TO',
    currentValue: (cadence: 'monthly' | 'annual') =>
      cadence === 'annual' ? "Today's annual value" : "Today's monthly value",
    newValue: (cadence: 'monthly' | 'annual') =>
      cadence === 'annual' ? 'New annual value' : 'New monthly value',
    valueTitle: 'WHAT CHANGES IN THE VALUE',
    gainTitle: "WHAT YOU'LL GAIN",
    loseTitle: "WHAT YOU'LL LOSE",
    keptTitle: 'YOUR MODULES CONTINUE',
    whenTitle: 'WHEN IT TAKES EFFECT',
    whenBody:
      'The change takes effect as soon as you confirm. Nothing is charged now: the pro-rated difference lands on your next invoice, which may be the one closing this cycle.',
    cta: 'CONFIRM CHANGE',
    ctaLoading: 'CONFIRMING...',
    voltar: 'BACK',
    confirming: 'Confirming your plan change...',
    pendingTitle: 'Change in progress.',
    pendingSubcopy: 'Once the change is confirmed your plan shows up updated here.',
    pendingCta: 'VIEW MY MEMBERSHIP',
    successToast: 'Plan changed.',
    appleTitle: 'App Store subscription',
    appleBody:
      'This subscription was purchased through the App Store. Changing plans happens there.',
    appleCta: 'OPEN APP STORE',
    blockedPastDueTitle: 'Payment pending',
    blockedPastDueBody: ALTERAR_PAST_DUE_BODY_EN,
    blockedPastDueCta: 'VIEW CHARGE',
    unavailableCadence:
      "The annual plan doesn't accept the add-on modules on your subscription. Remove the modules before switching to annual.",
    cancelScheduledNote:
      'Your subscription has a cancellation scheduled. Changing plans does not undo that cancellation.',
    errorGeneric: 'Could not change your plan. Try again.',
    errorUnavailable: 'Changing plans is unavailable right now. Try again later.',
    errorPastDue: ALTERAR_PAST_DUE_BODY_EN,
    errorNoChange: "You're already on this plan.",
    errorPlanNotFound: 'That plan is no longer available.',
    errorNoMembership: "You don't have an active subscription to change.",
    errorRateLimited: 'Too many attempts in a row. Wait a minute and try again.',
    errorUnauthorized: 'Your session expired. Sign in again to continue.',
  },
  // Added with the post-purchase welcome screen, so it carries a twin from
  // day one. Benefit labels stay out of here for the same reason as in PT:
  // they come from the subscription payload, not from copy.
  boasVindas: {
    eyebrow: 'MEMBERSHIP ACTIVE',
    title: 'Welcome to the Casa',
    subcopy:
      'Your payment is confirmed. From now on you are a member, with access to the meetups, the garage and the Casa curation.',
    planLabel: 'YOUR PLAN',
    benefitsTitle: "WHAT'S ALREADY YOURS",
    nextTitle: 'WHERE TO START',
    steps: {
      caixaTitle: 'Build your box',
      caixaBody: "Pick this cycle's curated items and confirm before the cutoff.",
      eventosTitle: 'Take your seat',
      eventosBody: 'See the next meetups and claim your spot before they fill up.',
      garagemTitle: 'Show your car',
      garagemBody: 'Add your car to the garage and be recognised at the meetups.',
    },
    cta: 'VIEW MY MEMBERSHIP',
    loading: 'Getting your welcome ready...',
  },
  // `unavailableTitle` / `unavailableSubcopy` were rewritten on this branch
  // (they used to say "em breve"), so they need twins too. State only: no
  // cause, no timeline — the screen cannot tell the flag-off case from a 503.
  minhaAssinatura: {
    unavailableTitle: 'Memberships are unavailable right now.',
    unavailableSubcopy: 'Please try again later.',
  },
} as const;

export type AssinaturasCopy = typeof assinaturasCopy;
