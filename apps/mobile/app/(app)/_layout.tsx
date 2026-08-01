import { router, Tabs } from 'expo-router';
import { CalendarDays, ShoppingBag, ShoppingCart, Ticket, UserRound } from 'lucide-react-native';
import { Platform } from 'react-native';

import { brand } from '~/brand';
import { CartProvider, useCart } from '~/cart/context';
import { getAppTabScreenOptions } from '~/navigation/app-tab-screen-options';
import { APP_TAB_SPECS, getCartTabBadge, getPrimaryTabName } from '~/navigation/app-tabs';
import { useStoreRuntime } from '~/store/runtime-context';

const ACTIVE = brand.color.brand;

const EventsIcon = ({ color }: { color: string }) => (
  <CalendarDays color={color} size={22} strokeWidth={1.75} />
);
const StoreIcon = ({ color }: { color: string }) => (
  <ShoppingBag color={color} size={22} strokeWidth={1.75} />
);
const CartIcon = ({ color }: { color: string }) => (
  <ShoppingCart color={color} size={22} strokeWidth={1.75} />
);
const TicketsIcon = ({ color }: { color: string }) => (
  <Ticket color={color} size={22} strokeWidth={1.75} />
);
const ProfileIcon = ({ color }: { color: string }) => (
  <UserRound color={color} size={22} strokeWidth={1.75} />
);

const screenOptions = getAppTabScreenOptions(Platform.OS === 'web' ? 'web' : 'native');

function AppTabs() {
  const { itemCount } = useCart();
  const cartBadge = getCartTabBadge(itemCount);
  const { runtimeStoreEnabled } = useStoreRuntime();
  const primaryTabName = getPrimaryTabName(runtimeStoreEnabled);
  const showDedicatedTicketsTab = primaryTabName === 'store';

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="events"
        options={{ title: APP_TAB_SPECS[0].title, tabBarIcon: EventsIcon }}
        listeners={{
          tabPress: (e) => {
            // Default tab-press behavior on web preserves dynamic params
            // (e.g. /events?eventSlug=...) which fails to pop deep routes
            // like /events/buy/[eventSlug]. Force a clean replace to /events.
            e.preventDefault();
            router.replace('/events');
          },
        }}
      />
      {primaryTabName === 'store' ? (
        <Tabs.Screen
          name="store"
          options={{ title: 'Loja', tabBarIcon: StoreIcon }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              router.replace('/store');
            },
          }}
        />
      ) : (
        <Tabs.Screen
          name="tickets"
          options={{ title: 'Ingressos', tabBarIcon: TicketsIcon }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              router.replace('/tickets');
            },
          }}
        />
      )}
      <Tabs.Screen
        name="cart"
        options={{
          title: APP_TAB_SPECS[2].title,
          tabBarIcon: CartIcon,
          tabBarBadgeStyle: {
            backgroundColor: ACTIVE,
            color: '#F5F5F5',
            fontFamily: 'Inter_700Bold',
            fontSize: 10,
          },
          ...(cartBadge ? { tabBarBadge: cartBadge } : {}),
        }}
      />
      {showDedicatedTicketsTab ? (
        <Tabs.Screen
          name="tickets"
          options={{ title: APP_TAB_SPECS[3].title, tabBarIcon: TicketsIcon }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              router.replace('/tickets');
            },
          }}
        />
      ) : (
        <Tabs.Screen name="store" options={{ href: null, title: 'Loja', tabBarIcon: StoreIcon }} />
      )}
      <Tabs.Screen name="garage" options={{ href: null, title: APP_TAB_SPECS[4].title }} />
      <Tabs.Screen name="assinaturas" options={{ href: null, title: 'Assinatura' }} />
      <Tabs.Screen
        name="profile"
        options={{ title: APP_TAB_SPECS[5].title, tabBarIcon: ProfileIcon }}
      />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notificações' }} />
    </Tabs>
  );
}

export default function AppLayout() {
  return (
    <CartProvider>
      <AppTabs />
    </CartProvider>
  );
}
