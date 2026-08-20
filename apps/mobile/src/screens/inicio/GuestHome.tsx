// Vitrine da tela de Início para o usuário não logado.
//
// Nove blocos, na ordem da emenda de escopo da task-12: header com o botão
// ENTRAR, apresentação, benefícios, status do clube, os dois CTAs, planos,
// eventos e experiências, loja e carros confirmados.
//
// Regra de erro DELIBERADAMENTE ASSIMÉTRICA (emenda de escopo):
// - `useHomeContent` cobre hero, institucional, benefícios, planos e
//   destaques curados numa única request. A falha dela é TOTAL: sem esses
//   dados não há tela, então loading e error escondem tudo e mostram um
//   skeleton ou um estado de erro central com retry.
// - `useClubStats`, a busca de próximos eventos, `StoreTeaserSection` e
//   `ConfirmedCarsSection` são COMPLEMENTARES: cada um vive dentro do seu
//   próprio bloco e falha para dentro dele. `ClubStatsSection` já trata
//   `stats: null` como "não renderizar nada"; a busca de eventos abaixo
//   cai para uma lista vazia em qualquer rejeição, o que por sua vez faz
//   `HighlightsSection` mostrar só os destaques curados (ou nada, se também
//   não houver destaque) e `ConfirmedCarsSection` receber `eventSlug: null`
//   e não chamar a API. Nenhum desses quatro pode derrubar o resto da tela.

import type { EventSummary } from '@ccc/shared/events';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listEvents } from '~/api/events';
import { buildLoginHref } from '~/auth/redirect-intent';
import { inicioCopy } from '~/copy/inicio';
import { useClubStats } from '~/hooks/useClubStats';
import { useHomeContent } from '~/hooks/useHomeContent';
import { AppHeader } from '~/screens/inicio/components/AppHeader';
import { p } from '~/screens/inicio/palette';
import { BenefitsSection } from '~/screens/inicio/sections/BenefitsSection';
import { ClubStatsSection } from '~/screens/inicio/sections/ClubStatsSection';
import { ConfirmedCarsSection } from '~/screens/inicio/sections/ConfirmedCarsSection';
import { CtaSection } from '~/screens/inicio/sections/CtaSection';
import { HeroSection } from '~/screens/inicio/sections/HeroSection';
import { HighlightsSection } from '~/screens/inicio/sections/HighlightsSection';
import { PlansSection } from '~/screens/inicio/sections/PlansSection';
import { StoreTeaserSection } from '~/screens/inicio/sections/StoreTeaserSection';

// Anônimo tocando em ENTRAR, assinar ou num plano vai para o login carregando
// o `next` correspondente. Ambos os prefixos estão liberados em
// src/auth/redirect-intent.ts, senão o destino seria descartado e o usuário
// cairia em DEFAULT_POST_AUTH.
const LOGIN_NEXT = '/welcome';
const SUBSCRIBE_PATH = '/assinaturas';

// Hoisted to module scope — o trap do task-9/task-11: um literal montado no
// corpo do componente teria identidade nova a cada render. Aqui o efeito
// abaixo já tem array de dependências vazio (roda uma vez, ponto), mas o
// objeto fica módulo-scoped mesmo assim, no mesmo padrão de
// useMemberHomeData.ts (NEXT_EVENT_QUERY) e StoreTeaserSection.tsx
// (TEASER_QUERY), para não introduzir a única exceção divergente do plano.
const UPCOMING_EVENTS_QUERY = { window: 'upcoming' as const, limit: 3 };

export function GuestHome() {
  const { content, loading, error, refresh } = useHomeContent();
  const { stats } = useClubStats();
  const [events, setEvents] = useState<EventSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listEvents(UPCOMING_EVENTS_QUERY)
      .then((res) => {
        if (!cancelled) setEvents(res.items);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // buildLoginHref returns a plain `string` (querystring appended), not a
  // typed expo-router route, so it needs the same `as never` cast the app
  // already uses for other dynamic hrefs (app/(app)/events/[slug].tsx).
  const goLogin = () => router.push(buildLoginHref(LOGIN_NEXT) as never);
  const goSignup = () => router.push('/signup');
  const goSubscribe = () => router.push(buildLoginHref(SUBSCRIBE_PATH) as never);
  const goLink = (path: string) => router.push(path as never);
  const goEvent = (slug: string) => router.push(`/events/${slug}` as never);

  const firstEventSlug = events[0]?.slug ?? null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader
          right={
            <Pressable
              onPress={goLogin}
              accessibilityRole="button"
              accessibilityLabel={inicioCopy.cta.login}
              testID="inicio-guest-login"
              style={({ pressed }) => [styles.loginButton, pressed ? styles.pressed : null]}
            >
              <Text style={styles.loginLabel}>{inicioCopy.cta.login}</Text>
            </Pressable>
          }
        />

        {loading ? <InicioSkeleton /> : null}

        {!loading && error ? <InicioError onRetry={() => void refresh()} /> : null}

        {!loading && !error && content ? (
          <>
            <HeroSection hero={content.hero} institutional={content.institutional} />
            <BenefitsSection benefits={content.benefits} />
            <ClubStatsSection stats={stats} />
            <CtaSection onCreateAccount={goSignup} onSubscribe={goSubscribe} />
            <PlansSection
              plans={content.plans}
              onOpenPlan={goSubscribe}
              onSeeAll={goSubscribe}
            />
            <HighlightsSection
              highlights={content.highlights}
              events={events}
              onOpenLink={goLink}
              onOpenEvent={goEvent}
            />
            <StoreTeaserSection />
            <ConfirmedCarsSection eventSlug={firstEventSlug} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// Skeleton nos formatos reais: hero, faixa de benefícios, cards de plano.
// Nunca spinner de tela cheia.
function InicioSkeleton() {
  return (
    <View style={styles.skeletonWrap} testID="inicio-skeleton">
      <View style={styles.skeletonHero} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonRow} />
      <View style={styles.skeletonRow} />
      <View style={styles.skeletonCard} />
      <View style={styles.skeletonCard} />
    </View>
  );
}

function InicioError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.errorWrap}>
      <Text style={styles.errorText}>{inicioCopy.states.errorTitle}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={inicioCopy.states.errorRetry}
        testID="inicio-error-retry"
        style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}
      >
        <Text style={styles.retryLabel}>{inicioCopy.states.errorRetry}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 48, gap: 26 },
  loginButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: p.gold,
  },
  loginLabel: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.gold,
    textTransform: 'uppercase',
  },
  skeletonWrap: { gap: 14 },
  skeletonHero: { height: 210, borderRadius: 20, backgroundColor: p.surface },
  skeletonLine: { height: 14, width: '60%', borderRadius: 7, backgroundColor: p.surface },
  skeletonRow: { height: 72, borderRadius: 14, backgroundColor: p.surface },
  skeletonCard: { height: 140, borderRadius: 14, backgroundColor: p.surface },
  errorWrap: { gap: 16, alignItems: 'flex-start' },
  errorText: {
    fontFamily: 'Jost_500Medium',
    fontSize: 14,
    lineHeight: 21,
    color: p.muted60,
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: p.gold,
  },
  pressed: { opacity: 0.85 },
  retryLabel: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.gold,
    textTransform: 'uppercase',
  },
});
