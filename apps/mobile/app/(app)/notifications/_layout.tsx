import { router, Stack } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { notificationsCopy } from '~/copy/notifications';

const headerStyle = { backgroundColor: '#0a0a0a' } as const;

export default function NotificationsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle,
        headerTintColor: '#F5F5F5',
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: notificationsCopy.title,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
