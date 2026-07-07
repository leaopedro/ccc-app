import { router, Stack } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable } from 'react-native';

export default function TicketsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#F5F5F5',
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Meus ingressos', headerBackVisible: false, headerLeft: () => null }}
      />
      <Stack.Screen
        name="[ticketId]"
        options={{
          title: 'Ingresso',
          headerLeft: () => (
            <Pressable
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/tickets');
                }
              }}
              hitSlop={8}
            >
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
