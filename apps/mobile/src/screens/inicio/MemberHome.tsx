// Home do membro logado, conforme o handoff (task-11).
//
// Seis fontes independentes (useMemberHomeData) mais useHomeContent e
// useClubStats (Task 5, cada uma já com seu próprio loading/error). Falha
// de uma nunca esconde as demais: cada seção (Task 10) já trata `null` como
// "não mostrar nada", então esta tela só encaminha `data` — loading e erro
// colapsam para o mesmo `null`, sem spinner nem retry por bloco (nenhuma
// das sete seções expõe um prop de loading).
//
// Badges ficam fora (ruling do Task 10, fix round 1): não há fetch de
// badges aqui.
//
// Bell: mesmo tratamento visual do welcome.tsx atual (círculo com contagem,
// "99+" acima de 99), reescrito com os tokens de `~/screens/inicio/palette`
// em vez dos hex/`brand.color` que o welcome.tsx usa.

import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '~/auth/context';
import { notificationsCopy } from '~/copy/notifications';
import { useClubStats } from '~/hooks/useClubStats';
import { useHomeContent } from '~/hooks/useHomeContent';
import { useUnreadCount } from '~/hooks/useUnreadCount';
import { AppHeader } from '~/screens/inicio/components/AppHeader';
import { p } from '~/screens/inicio/palette';
import { BoxSection } from '~/screens/inicio/sections/BoxSection';
import { ClubStatsSection } from '~/screens/inicio/sections/ClubStatsSection';
import { HeroSection } from '~/screens/inicio/sections/HeroSection';
import { MemberGreeting } from '~/screens/inicio/sections/MemberGreeting';
import { MyGarageSection } from '~/screens/inicio/sections/MyGarageSection';
import { MyTicketsSection } from '~/screens/inicio/sections/MyTicketsSection';
import { NextEventCard } from '~/screens/inicio/sections/NextEventCard';
import { QuickAccessSection } from '~/screens/inicio/sections/QuickAccessSection';
import { SubscriptionSection } from '~/screens/inicio/sections/SubscriptionSection';
import { useMemberHomeData } from '~/screens/inicio/useMemberHomeData';

export function MemberHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { content } = useHomeContent();
  const { stats } = useClubStats();
  const { profile, nextEvent, tickets, garage, premium, box } = useMemberHomeData();
  const { count: unreadCount } = useUnreadCount(true);

  const firstName = (user?.name ?? profile.data?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const isPremiumActive = garage.data?.garage.isPremiumActive ?? false;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0
                  ? notificationsCopy.accessibilityUnread(unreadCount)
                  : notificationsCopy.accessibilityBell
              }
              hitSlop={8}
              onPress={() => router.push('/notifications')}
              testID="inicio-bell"
              style={styles.bellButton}
            >
              <Bell color={p.cream} size={22} strokeWidth={1.75} />
              {unreadCount > 0 ? (
                <View style={styles.badge} testID="inicio-bell-badge">
                  <Text style={styles.badgeText} numberOfLines={1}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          }
        />

        {content ? <HeroSection hero={content.hero} institutional={content.institutional} /> : null}

        <MemberGreeting firstName={firstName || null} createdAt={profile.data?.createdAt ?? null} />

        <NextEventCard
          event={nextEvent.data}
          onPress={(slug) => router.push(`/events/${slug}`)}
        />

        <ClubStatsSection stats={stats} />

        <MyTicketsSection
          tickets={tickets.data ?? []}
          onOpenTicket={(id) => router.push(`/tickets/${id}`)}
          onSeeAll={() => router.push('/tickets')}
        />

        <MyGarageSection garage={garage.data} onPress={() => router.push('/garage')} />

        <SubscriptionSection
          status={premium.data}
          onManage={() => router.push('/assinaturas/minha-assinatura')}
          onSubscribe={() => router.push('/assinaturas')}
        />

        <BoxSection
          box={box.data}
          isPremiumActive={isPremiumActive}
          onPress={() => router.push('/caixa')}
        />

        <QuickAccessSection onNavigate={(path) => router.push(path as never)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 48,
    gap: 26,
  },
  bellButton: {
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: p.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: p.bg,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 13,
  },
});
