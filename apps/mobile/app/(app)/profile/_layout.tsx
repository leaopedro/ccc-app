import { router, Stack } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { profileCopy } from '~/copy/profile';

const headerStyle = { backgroundColor: '#0a0a0a' } as const;

export default function ProfileLayout() {
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
          title: profileCopy.profile.title,
          headerBackVisible: false,
          headerLeft: () => null,
        }}
      />
      <Stack.Screen
        name="edit"
        options={{
          title: profileCopy.profile.edit,
          headerLeft: () => (
            <Pressable onPress={() => router.replace('/profile')} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="orders"
        options={{
          title: profileCopy.menu.orders,
          headerLeft: () => (
            <Pressable onPress={() => router.replace('/profile')} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="push-preferences"
        options={{
          title: profileCopy.pushPreferences.title,
          headerLeft: () => (
            <Pressable onPress={() => router.replace('/profile')} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="premium"
        options={{
          title: 'Premium Gold',
          headerLeft: () => (
            <Pressable onPress={() => router.replace('/profile')} hitSlop={8}>
              <ChevronLeft color="#F5F5F5" size={24} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
