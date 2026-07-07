import type {
  ConfirmedCar,
  EventDetailCommerce,
  EventDetailPublic,
  TicketTier,
} from '@jdm/shared/events';
import type { TicketSource } from '@jdm/shared/tickets';
import { Button } from '@jdm/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Ticket as TicketIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getConfirmedCars, getEvent, getEventCommerce } from '~/api/events';
import { getMyTicketForEvent } from '~/api/tickets';
import { useAuth } from '~/auth/context';
import { useCart } from '~/cart/context';
import { getCartAddErrorMessage } from '~/cart/error-message';
import { cartCopy } from '~/copy/cart';
import { eventsCopy } from '~/copy/events';
import { ticketsCopy } from '~/copy/tickets';
import { capacityLabel, isCapacityBlocked } from '~/lib/capacity-display';
import { showMessage } from '~/lib/confirm';
import { formatBRL, formatEventDateRange } from '~/lib/format';
import { isBuyCtaDisabled, resolveBuyCta } from '~/screens/events/buy-cta';
import { AllCarsSheet } from '~/screens/events/confirmed-cars/AllCarsSheet';
import { CarDetailSheet } from '~/screens/events/confirmed-cars/CarDetailSheet';
import { ConfirmedCarsSection } from '~/screens/events/confirmed-cars/ConfirmedCarsSection';
import { EventFeedSection } from '~/screens/events/feed/EventFeedSection';
import { theme } from '~/theme';

export default function EventDetailScreen() {
  const { slug, tierId: requestedTierId } = useLocalSearchParams<{
    slug: string;
    tierId?: string;
  }>();
  const router = useRouter();
  const [publicEvent, setPublicEvent] = useState<EventDetailPublic | null>(null);
  const [commerceEvent, setCommerceEvent] = useState<EventDetailCommerce | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [ticketSource, setTicketSource] = useState<TicketSource | null>(null);
  const [confirmedCars, setConfirmedCars] = useState<ConfirmedCar[]>([]);
  const [confirmedCarsLoading, setConfirmedCarsLoading] = useState(false);
  const [selectedCar, setSelectedCar] = useState<ConfirmedCar | null>(null);
  const [allSheetOpen, setAllSheetOpen] = useState(false);
  const [carFromAll, setCarFromAll] = useState(false);
  const { addItem, adding } = useCart();
  const { status: authStatus } = useAuth();
  const insets = useSafeAreaInsets();
  const backTop = Platform.OS === 'web' ? 16 : Math.max(insets.top, 16);
  const isAnon = authStatus === 'unauthenticated';
  const isAuthed = authStatus === 'authenticated';

  useEffect(() => {
    if (!slug || typeof slug !== 'string') return;
    void (async () => {
      try {
        setPublicEvent(await getEvent(slug));
      } catch {
        setError(eventsCopy.errors.notFound);
      }
    })();
  }, [slug]);

  useEffect(() => {
    if (!slug || typeof slug !== 'string') return;
    if (!isAuthed) {
      setCommerceEvent(null);
      return;
    }
    void (async () => {
      try {
        const nextCommerceEvent = await getEventCommerce(slug);
        setCommerceEvent(nextCommerceEvent);
        if (typeof requestedTierId === 'string') {
          const requestedTier = nextCommerceEvent.tiers.find(
            (tier) => tier.id === requestedTierId && tier.remainingCapacity > 0,
          );
          if (requestedTier) {
            setSelectedTierId(requestedTier.id);
          }
        }
      } catch {
        setCommerceEvent(null);
      }
    })();
  }, [slug, isAuthed, requestedTierId]);

  const event: EventDetailPublic | EventDetailCommerce | null = commerceEvent ?? publicEvent;

  const hasTicket = ticketSource !== null;

  // Prefer commerce tiers (authed); fall back to the public hasCarTier flag for anonymous users.
  const hasCarTier =
    commerceEvent?.tiers.some((t) => t.requiresCar) ?? publicEvent?.hasCarTier ?? false;

  useEffect(() => {
    if (!slug || typeof slug !== 'string') return;
    let cancelled = false;
    setConfirmedCarsLoading(true);
    void (async () => {
      try {
        const res = await getConfirmedCars(slug);
        if (!cancelled) setConfirmedCars(res.items);
      } catch {
        if (!cancelled) setConfirmedCars([]);
      } finally {
        if (!cancelled) setConfirmedCarsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!event || isAnon || authStatus === 'loading') {
      setTicketSource(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ticket = await getMyTicketForEvent(event.id);
        if (!cancelled) setTicketSource(ticket?.source ?? null);
      } catch {
        if (!cancelled) setTicketSource(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event, isAnon, authStatus]);

  const openMap = (e: EventDetailPublic) => {
    const parts = [e.venueName, e.venueAddress, e.city, e.stateCode].filter(Boolean);
    if (parts.length === 0) return;
    const q = encodeURIComponent(parts.join(', '));
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
  };

  const addToCart = async (tier: TicketTier) => {
    if (!commerceEvent) return;
    if (tier.requiresCar) {
      router.push({
        pathname: '/cart/car-plate',
        params: { eventId: commerceEvent.id, tierId: tier.id },
      } as never);
      return;
    }
    try {
      await addItem({
        eventId: commerceEvent.id,
        tierId: tier.id,
        source: 'purchase',
        kind: 'ticket',
        quantity: 1,
        tickets: [{ extras: [] }],
        metadata: { source: 'mobile' },
      });
      router.push('/cart' as never);
    } catch (error: unknown) {
      showMessage(getCartAddErrorMessage(error));
    }
  };

  const handlePurchasePress = async () => {
    const action = resolveBuyCta({
      authStatus,
      eventSlug: event?.slug ?? '',
      selectedTierId: selectedTier?.id ?? null,
    });
    if (action.kind === 'login') {
      router.push(action.href as never);
      return;
    }
    if (action.kind === 'noop' || !selectedTier) {
      return;
    }
    await addToCart(selectedTier);
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!event) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const selectedTier = commerceEvent?.tiers.find((t) => t.id === selectedTierId) ?? null;
  const isSheetOpen = selectedCar !== null || allSheetOpen;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.container}
        importantForAccessibility={isSheetOpen ? 'no-hide-descendants' : 'auto'}
      >
        <View>
          {event.coverUrl ? (
            <Image source={{ uri: event.coverUrl }} style={styles.cover} accessible={false} />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]} />
          )}
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/events'))}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={8}
            style={[styles.backButton, { top: backTop }]}
          >
            <ArrowLeft color="#F5F5F5" size={22} strokeWidth={2} />
          </Pressable>
        </View>
        <View style={styles.section}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={3}>
              {event.title}
            </Text>
            {hasTicket ? (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/tickets',
                    params: { eventId: event.id },
                  } as never)
                }
                accessibilityRole="button"
                accessibilityLabel={eventsCopy.detail.viewMyTickets}
                style={styles.viewTicketsBtn}
                hitSlop={8}
              >
                <TicketIcon color={theme.colors.bg} size={14} strokeWidth={2} />
                <Text style={styles.viewTicketsText}>{eventsCopy.detail.viewMyTickets}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.sub}>{formatEventDateRange(event.startsAt, event.endsAt)}</Text>
        </View>

        {(() => {
          const locationLine = [event.venueAddress, event.city, event.stateCode]
            .filter(Boolean)
            .join(', ');
          const hasAny = event.venueName || locationLine;
          if (!hasAny) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.h2}>{eventsCopy.detail.venue}</Text>
              {event.venueName ? <Text style={styles.body}>{event.venueName}</Text> : null}
              {locationLine ? <Text style={styles.sub}>{locationLine}</Text> : null}
              <Pressable
                onPress={() => openMap(event)}
                style={styles.mapButton}
                accessibilityRole="button"
                accessibilityLabel={eventsCopy.detail.openMaps}
                accessibilityHint="Opens location in Maps"
              >
                <Text style={styles.mapLabel}>{eventsCopy.detail.openMaps}</Text>
              </Pressable>
            </View>
          );
        })()}

        <View style={styles.section}>
          <Text style={styles.body}>{event.description}</Text>
        </View>

        <ConfirmedCarsSection
          cars={confirmedCars}
          loading={confirmedCarsLoading}
          visible={confirmedCarsLoading || confirmedCars.length > 0 || hasCarTier}
          onSelectCar={(car) => {
            setCarFromAll(false);
            setSelectedCar(car);
          }}
          onOpenAllSheet={() => setAllSheetOpen(true)}
        />

        {commerceEvent ? (
          <View style={styles.section}>
            <Text style={styles.h2}>{ticketsCopy.purchase.pickTier}</Text>
            {commerceEvent.tiers.map((t) => {
              const blocked = isCapacityBlocked(t.capacityDisplay);
              const label = capacityLabel(t.capacityDisplay);
              const isSelected = selectedTierId === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => !blocked && setSelectedTierId(t.id)}
                  disabled={blocked}
                  style={[
                    styles.tier,
                    isSelected && styles.tierSelected,
                    blocked && styles.tierDisabled,
                  ]}
                  accessibilityRole="radio"
                  accessibilityLabel={`${t.name}, ${formatBRL(t.displayPriceCents)}`}
                  accessibilityState={{ selected: isSelected, disabled: blocked }}
                  accessibilityHint={blocked ? undefined : 'Select this ticket tier'}
                >
                  <View style={styles.tierTop}>
                    <Text style={styles.tierName}>{t.name}</Text>
                    <Text style={styles.tierPrice}>{formatBRL(t.displayPriceCents)}</Text>
                  </View>
                  {label !== null ? <Text style={styles.sub}>{label}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Button
            label={adding ? cartCopy.actions.adding : cartCopy.actions.addToCart}
            onPress={() => void handlePurchasePress()}
            disabled={
              adding ||
              isBuyCtaDisabled({
                authStatus,
                eventSlug: event.slug,
                selectedTierId: selectedTier?.id ?? null,
              })
            }
          />
        </View>

        {event.feedEnabled ? (
          <EventFeedSection
            eventSlug={event.slug}
            eventId={event.id}
            feedSettings={{
              feedEnabled: event.feedEnabled,
              feedAccess: event.feedAccess,
              postingAccess: event.postingAccess,
              maxPostsPerUser: null,
              maxPhotosPerUser: 5,
            }}
            ticketSource={ticketSource}
            embedded
          />
        ) : null}
      </ScrollView>

      <CarDetailSheet
        car={selectedCar}
        onClose={() => {
          const fromAll = carFromAll;
          setSelectedCar(null);
          setCarFromAll(false);
          if (fromAll) setAllSheetOpen(true);
        }}
      />

      <AllCarsSheet
        visible={allSheetOpen}
        cars={confirmedCars}
        onClose={() => setAllSheetOpen(false)}
        onSelectCar={(car) => {
          setAllSheetOpen(false);
          setCarFromAll(true);
          setSelectedCar(car);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  container: { paddingBottom: theme.spacing.xl, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: { width: '100%', height: 220 },
  coverPlaceholder: { backgroundColor: theme.colors.border },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 10, 10, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { padding: theme.spacing.lg, gap: theme.spacing.xs },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    flex: 1,
    flexShrink: 1,
  },
  viewTicketsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    backgroundColor: theme.colors.fg,
  },
  viewTicketsText: {
    color: theme.colors.bg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  h2: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
    marginBottom: theme.spacing.md,
  },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md },
  sub: { color: theme.colors.muted },
  error: { color: theme.colors.muted },
  mapButton: {
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.border,
    alignSelf: 'flex-start',
  },
  mapLabel: { color: theme.colors.fg },
  tier: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  tierSelected: { borderColor: theme.colors.fg, borderWidth: 2 },
  tierDisabled: { opacity: 0.5 },
  tierTop: { flexDirection: 'row', justifyContent: 'space-between' },
  tierName: { color: theme.colors.fg, fontWeight: '600' },
  tierPrice: { color: theme.colors.fg },
});
