import { Redirect, Stack } from 'expo-router';

import { useAuth } from '~/auth/context';
import { useStoreAvailability } from '~/store/runtime-context';

export default function StoreLayout() {
  const auth = useAuth();
  const storeAvailable = useStoreAvailability();

  if (!storeAvailable) {
    if (auth.status === 'authenticated') {
      return <Redirect href="/tickets" />;
    }
    return <Redirect href="/events" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
