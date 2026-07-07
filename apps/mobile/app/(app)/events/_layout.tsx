import { Stack } from 'expo-router';

export default function EventsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[slug]" />
      <Stack.Screen name="buy/[eventSlug]" />
      <Stack.Screen name="buy/checkout-return" />
      <Stack.Screen name="buy/checkout-confirmed" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
