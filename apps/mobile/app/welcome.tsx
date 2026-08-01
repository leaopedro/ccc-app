import { brand } from '@ccc/design';
import type { EventSummary } from '@ccc/shared/events';
import { Badge, Button, Card, Text } from '@ccc/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { Bell, User } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, Text as RNText, View } from 'react-native';

import { listEvents } from '~/api/events';
import { useAuth } from '~/auth/context';
import { buildLoginHref } from '~/auth/redirect-intent';
import { notificationsCopy } from '~/copy/notifications';
import { useUnreadCount } from '~/hooks/useUnreadCount';
import { formatEventDateRange } from '~/lib/format';
import { captureException } from '~/lib/sentry';

const copy = {
  greeting: (name: string) => `OLÁ, ${name.toUpperCase()}`,
  hero: brand.tagline,
  nextEyebrow: 'Próximo evento',
  ctaSeeEvent: 'Ver evento',
  secondaryEyebrow: 'Também no clube',
  secondaryCta: 'Ver todos',
  emptyTitle: 'Nenhum evento agendado.',
  emptySub: 'Volte logo. O clube está se preparando.',
  errorLine: 'Não rolou carregar. Tenta de novo.',
  errorRetry: 'Tentar novamente',
  badgeSoon: 'EM BREVE',
} as const;

const eventTypeLabel: Record<EventSummary['type'], string> = {
  meeting: 'ENCONTRO',
  drift: 'DRIFT',
  other: 'EVENTO',
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const isSoon = (iso: string) => {
  const t = new Date(iso).getTime() - Date.now();
  return t > 0 && t < SEVEN_DAYS_MS;
};

const venueLine = (e: EventSummary) =>
  [e.venueName, [e.city, e.stateCode].filter(Boolean).join('/')].filter(Boolean).join(' · ');

export default function Welcome() {
  const router = useRouter();
  const { user, status } = useAuth();
  const isAnon = status === 'unauthenticated';
  const isAuthSettled = status !== 'loading';
  const [items, setItems] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profileNavGuard = useRef(false);
  const { count: unreadCount } = useUnreadCount(!isAnon && isAuthSettled);

  const handleProfilePress = useCallback(() => {
    if (!isAuthSettled || profileNavGuard.current) return;

    profileNavGuard.current = true;

    const safePush = (href: string) => {
      try {
        const result = router.push(href as never);
        Promise.resolve(result).catch((error) => {
          captureException(error, 'welcome.profile-button.push');
        });
      } catch (error) {
        captureException(error, 'welcome.profile-button.push');
      }
    };

    try {
      if (isAnon) {
        safePush(buildLoginHref('/welcome'));
      } else if (!user) {
        captureException(
          new Error('welcome.profile-button.missing-user'),
          'welcome.profile-button',
        );
        safePush(buildLoginHref('/welcome'));
      } else {
        safePush('/profile');
      }
    } catch (error) {
      captureException(error, 'welcome.profile-button');
    } finally {
      profileNavGuard.current = false;
    }
  }, [isAuthSettled, isAnon, router, user]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await listEvents({ window: 'upcoming', limit: 4 });
      setItems(res.items);
    } catch {
      setItems([]);
      setError(copy.errorLine);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const hero = items && items.length > 0 ? items[0] : null;
  const secondary = items && items.length > 1 ? items.slice(1, 4) : [];

  return (
    <SafeAreaView className="flex-1 bg-bg" style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
            source={require('@ccc/design/assets/logo-wordmark.webp')}
            accessibilityLabel={brand.name}
            style={{ width: 84, height: 28, resizeMode: 'contain' }}
          />
          <View className="flex-row items-center gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0
                  ? notificationsCopy.accessibilityUnread(unreadCount)
                  : notificationsCopy.accessibilityBell
              }
              hitSlop={8}
              disabled={isAnon || !isAuthSettled}
              onPress={() => router.push('/notifications' as never)}
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
            >
              <Bell color="#F5F5F5" size={22} strokeWidth={1.75} />
              {unreadCount > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: brand.color.brand,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 3,
                  }}
                >
                  <RNText
                    style={{ color: '#fff', fontSize: 9, fontWeight: '700', lineHeight: 13 }}
                    numberOfLines={1}
                  >
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </RNText>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isAnon ? 'Entrar' : 'Perfil'}
              hitSlop={8}
              disabled={!isAuthSettled}
              style={({ pressed }) => [
                pressed ? { opacity: 0.7 } : null,
                !isAuthSettled ? { opacity: 0.5 } : null,
              ]}
              onPress={handleProfilePress}
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
            >
              <User color="#F5F5F5" size={22} strokeWidth={1.75} />
            </Pressable>
          </View>
        </View>

        <View className="px-5 pt-2 pb-6 gap-1">
          <Text variant="caption" tone="muted">
            {firstName ? copy.greeting(firstName) : 'OLÁ'}
          </Text>
          <Text
            variant="h1"
            weight="bold"
            className="font-display tracking-tight"
            accessibilityRole="header"
          >
            {copy.hero}
          </Text>
        </View>

        <View className="px-5 pb-3">
          <Text variant="bodyLg" tone="secondary">
            {copy.nextEyebrow}
          </Text>
        </View>

        <View className="px-5">
          {items === null ? (
            <HeroSkeleton />
          ) : error ? (
            <HeroError onRetry={() => void load()} />
          ) : !hero ? (
            <HeroEmpty />
          ) : (
            <HeroCard event={hero} onPress={() => router.push(`/events/${hero.slug}`)} />
          )}
        </View>

        {secondary.length > 0 ? (
          <View className="pt-8">
            <View className="flex-row items-center justify-between px-5 pb-3">
              <Text variant="bodyLg" tone="secondary">
                {copy.secondaryEyebrow}
              </Text>
              <Pressable onPress={() => router.push('/events')} accessibilityRole="link">
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {copy.secondaryCta}
                </Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 px-5"
            >
              {secondary.map((e) => (
                <SecondaryCard
                  key={e.id}
                  event={e}
                  onPress={() => router.push(`/events/${e.slug}`)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroCard({ event, onPress }: { event: EventSummary; onPress: () => void }) {
  const soon = isSoon(event.startsAt);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${formatEventDateRange(event.startsAt, event.endsAt)}`}
      className="rounded-xl overflow-hidden bg-surface active:opacity-90"
    >
      <View className="relative">
        {event.coverUrl ? (
          <Image
            source={{ uri: event.coverUrl }}
            accessible={false}
            style={{ width: '100%', aspectRatio: 16 / 9 }}
          />
        ) : (
          <View className="bg-surface-alt" style={{ width: '100%', aspectRatio: 16 / 9 }} />
        )}
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.85)']}
          locations={[0.4, 1]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          pointerEvents="none"
        />
        {soon ? (
          <View className="absolute top-3 left-3">
            <Badge tone="brand" label={copy.badgeSoon} size="sm" />
          </View>
        ) : null}
      </View>
      <View className="p-4 gap-3">
        <Text variant="eyebrow" tone="brand">
          {eventTypeLabel[event.type]}
        </Text>
        <Text variant="h1" weight="bold" className="font-display tracking-tight" numberOfLines={2}>
          {event.title}
        </Text>
        <View className="gap-1">
          <Text variant="body" tone="secondary">
            {formatEventDateRange(event.startsAt, event.endsAt)}
          </Text>
          {venueLine(event) ? (
            <Text variant="bodySm" tone="muted">
              {venueLine(event)}
            </Text>
          ) : null}
        </View>
        <View className="pt-2">
          <Button
            label={copy.ctaSeeEvent}
            variant="primary"
            size="lg"
            fullWidth
            onPress={onPress}
          />
        </View>
      </View>
    </Pressable>
  );
}

function SecondaryCard({ event, onPress }: { event: EventSummary; onPress: () => void }) {
  const meta = [event.city, event.stateCode].filter(Boolean).join('/');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${formatEventDateRange(event.startsAt, event.endsAt)}`}
      style={{ width: 240 }}
    >
      <Card variant="raised" padding="none">
        {event.coverUrl ? (
          <Image
            source={{ uri: event.coverUrl }}
            accessible={false}
            style={{ width: '100%', aspectRatio: 16 / 9 }}
          />
        ) : (
          <View className="bg-surface-alt" style={{ width: '100%', aspectRatio: 16 / 9 }} />
        )}
        <View className="p-3 gap-1">
          <Text variant="caption" tone="muted">
            {formatEventDateRange(event.startsAt, event.endsAt)}
          </Text>
          <Text variant="h3" numberOfLines={2}>
            {event.title}
          </Text>
          {meta ? (
            <Text variant="caption" tone="muted">
              {meta}
            </Text>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function HeroSkeleton() {
  return (
    <Card variant="raised" padding="none">
      <View className="bg-surface-alt" style={{ width: '100%', aspectRatio: 16 / 9 }} />
      <View className="p-5 gap-3">
        <View className="h-3 w-20 rounded-md bg-surface-alt" />
        <View className="h-6 w-3/4 rounded-md bg-surface-alt" />
        <View className="h-3 w-1/2 rounded-md bg-surface-alt" />
        <View className="h-12 mt-2 rounded-lg bg-surface-alt" />
      </View>
    </Card>
  );
}

function HeroError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card variant="raised" padding="lg">
      <View className="gap-4 items-start">
        <Text variant="body" tone="secondary">
          {copy.errorLine}
        </Text>
        <Button label={copy.errorRetry} variant="secondary" onPress={onRetry} />
      </View>
    </Card>
  );
}

function HeroEmpty() {
  return (
    <Card variant="raised" padding="lg">
      <View className="gap-1">
        <Text variant="h3">{copy.emptyTitle}</Text>
        <Text variant="bodySm" tone="muted">
          {copy.emptySub}
        </Text>
      </View>
    </Card>
  );
}
