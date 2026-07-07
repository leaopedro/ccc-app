import { router, Stack } from 'expo-router';
import { X } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { buyCopy } from '~/copy/buy';
import { cartCopy } from '~/copy/cart';

const headerStyle = { backgroundColor: '#0a0a0a' } as const;

const CloseButton = () => (
  <Pressable
    onPress={() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/events');
      }
    }}
    accessibilityRole="button"
    accessibilityLabel={cartCopy.actions.close}
    hitSlop={12}
    style={{ paddingHorizontal: 12, paddingVertical: 6 }}
  >
    <X color="#F5F5F5" size={22} strokeWidth={1.75} />
  </Pressable>
);

export default function CartLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle,
        headerTintColor: '#F5F5F5',
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ headerTitle: cartCopy.title, headerRight: () => <CloseButton /> }}
      />
      <Stack.Screen name="car-plate" options={{ headerTitle: buyCopy.carPlate.title }} />
    </Stack>
  );
}
