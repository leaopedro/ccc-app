import { Stack } from 'expo-router';

export default function GarageLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: 'Garagem' }} />
      <Stack.Screen name="new" options={{ title: 'Novo Carro' }} />
    </Stack>
  );
}
